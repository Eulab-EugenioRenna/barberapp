import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { ALORA_FUNCTIONS, canUseLocalFunction } from "../../common/function-catalog";
import { requireTenantId, requireUser, resolveRequestSession } from "../../common/request-session";
import { PrismaService } from "../../prisma/prisma.service";
import { TeamService } from "./team.service";
export interface LocalPolicyInput { role: "manager" | "reception" | "collaborator"; permissions: string[]; collaboratorId?: string | null; }
const editableRoles = ["manager", "reception", "collaborator"] as const;
@Injectable()
export class TeamLocalPolicyService {
  constructor(private readonly prisma: PrismaService, private readonly team: TeamService) {}
  async list(authorization?: string) {
    const session = await resolveRequestSession(this.prisma, authorization);
    const tenantId = requireTenantId(session);
    const actor = requireUser(session);
    if (!canUseLocalFunction(actor, "users.manage")) throw new ForbiddenException();
    const [users, collaborators] = await Promise.all([
      this.prisma.user.findMany({ where: { tenantId, role: { in: ["owner", ...editableRoles] } }, orderBy: [{ firstName: "asc" }, { id: "asc" }], select: {
        id: true, firstName: true, lastName: true, role: true, permissions: true, permissionsConfigured: true,
        collaborator: { select: { id: true, tenantId: true } },
      } }),
      this.prisma.collaborator.findMany({ where: { tenantId }, orderBy: [{ firstName: "asc" }, { id: "asc" }], select: { id: true, firstName: true, lastName: true, userId: true, isActive: true } }),
    ]);
    return { users: users.map(user => ({ ...user, collaborator: user.collaborator?.tenantId === tenantId ? { id: user.collaborator.id } : null })), collaborators, functions: ALORA_FUNCTIONS.filter(fn => canUseLocalFunction(actor, fn.key)).map(({ key, name }) => ({ key, name })) };
  }
  async save(authorization: string | undefined, id: string, body: LocalPolicyInput) {
    return this.team.withTeam(authorization, async (client, token, session) => {
      const tenantId = requireTenantId(session), actor = requireUser(session);
      if (actor.id === id || !canUseLocalFunction(actor, "team.manage")) throw new ForbiddenException("Non puoi modificare il tuo ambito operativo o ampliare la tua delega");
      const team = await client.teamOverview(token);
      const target = team.users.find(user => user.localUserId === id);
      if (!team.canManage || !target) throw new ForbiddenException("Account fuori dall’installazione o dalla delega");
      const targetRoles = target.roles.map(role => team.roles.find(item => item.id === role.id));
      const delegated = new Set(team.delegation.map(fn => fn.key));
      if (targetRoles.some(role => !role || role.permissions.some(key => !delegated.has(key)))) throw new ForbiddenException("Account con privilegi fuori dalla tua delega");
      const central = new Set(targetRoles.flatMap(role => role?.permissions || []));
      const licensed = new Set(team.functions.filter(fn => fn.delegable).map(fn => fn.key));
      const permissions = [...new Set(body.permissions)];
      if (permissions.some(key => !canUseLocalFunction(actor, key) || !central.has(key) || !licensed.has(key) || (body.role === "collaborator" && !["appointments.read.own", "appointments.update.own", "dashboard.personal.values.read"].includes(key)))) throw new ForbiddenException("Le restrizioni locali devono restare entro ruolo, licenza e delega Connect");
      return this.prisma.$transaction(async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"team-policy:" + tenantId}, 0))`;
        const user = await tx.user.findFirst({ where: { id, tenantId, role: { in: [...editableRoles] } }, include: { collaborator: true, accountIntent: true } });
        if (user?.accountIntent && !user.accountIntent.completedAt) throw new ConflictException("Completa la creazione prima di modificare la visibilità");
        if (!user) throw new NotFoundException("Account locale non modificabile in questa attività");
        if (user.collaborator && user.collaborator.tenantId !== tenantId) throw new ForbiddenException("Associazione precedente del professionista da riconciliare");
        if ((user.connectSubject && user.connectSubject !== target.subject) || (user.connectInstallationId && user.connectInstallationId !== team.installationId)) throw new ForbiddenException("Collegamento Connect dell’account non coerente");
        const collaboratorId = body.collaboratorId === undefined ? user.collaborator?.id || null : body.collaboratorId;
        if (permissions.some(key => ["appointments.read.own", "appointments.update.own", "dashboard.personal.values.read"].includes(key)) && !collaboratorId) throw new BadRequestException("Associa un professionista per abilitare l’agenda personale");
        if (body.collaboratorId === undefined && collaboratorId) {
          const active = await tx.collaborator.findFirst({ where: { id: collaboratorId, tenantId, isActive: true, userId: id } });
          if (!active) throw new NotFoundException("Professionista non disponibile in questa attività");
        }
        if (body.collaboratorId !== undefined) await assignProfessional(tx, tenantId, id, collaboratorId);
        return tx.user.update({ where: { id, tenantId, role: { in: [...editableRoles] } }, data: { role: body.role, permissions, permissionsConfigured: true }, select: { id: true, role: true, permissions: true, permissionsConfigured: true, collaborator: { select: { id: true } } } });
      });
    });
  }
  /** The owner may execute services too. This command never writes roles or permissions. */
  async associateSelf(authorization: string | undefined, collaboratorId: string | null) {
    return this.team.withTeam(authorization, async (client, token, session) => {
      const tenantId = requireTenantId(session), actor = requireUser(session);
      if (actor.role !== "owner" || !canUseLocalFunction(actor, "team.manage")) throw new ForbiddenException("Associazione riservata al titolare autorizzato");
      const team = await client.teamOverview(token);
      const target = team.users.find(user => user.localUserId === actor.id);
      if (!team.canManage || !target || target.accessRevoked || !target.identityEnabled || !target.membershipEnabled) throw new ForbiddenException("Account fuori dall’installazione o non attivo");
      return this.prisma.$transaction(async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"team-policy:" + tenantId}, 0))`;
        const user = await tx.user.findFirst({ where: { id: actor.id, tenantId, role: "owner" }, include: { collaborator: true } });
        if (!user) throw new NotFoundException("Titolare non disponibile in questa attività");
        if (user.connectSubject !== target.subject || user.connectInstallationId !== team.installationId) throw new ForbiddenException("Collegamento Connect dell’account non coerente");
        if (user.collaborator && user.collaborator.tenantId !== tenantId) throw new ForbiddenException("Associazione precedente del professionista da riconciliare");
        await assignProfessional(tx, tenantId, user.id, collaboratorId);
        return { id: user.id, collaborator: collaboratorId ? { id: collaboratorId } : null };
      });
    });
  }
}

export async function assignProfessional(tx: Prisma.TransactionClient, tenantId: string, userId: string, collaboratorId: string | null) {
    if (collaboratorId) {
      const professional = await tx.collaborator.findFirst({ where: { id: collaboratorId, tenantId, isActive: true } });
      if (!professional) throw new NotFoundException("Professionista non disponibile in questa attività");
      if (professional.userId && professional.userId !== userId) throw new ConflictException("Questo professionista è già associato a un altro account");
    }
    await tx.collaborator.updateMany({ where: { tenantId, userId }, data: { userId: null } });
    if (collaboratorId) {
      const assigned = await tx.collaborator.updateMany({ where: { id: collaboratorId, tenantId, isActive: true, OR: [{ userId: null }, { userId }] }, data: { userId } });
      if (assigned.count !== 1) throw new ConflictException("Associazione cambiata: aggiorna la squadra prima di riprovare");
    }
  }
