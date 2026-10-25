import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
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
        const user = await tx.user.findFirst({ where: { id, tenantId, role: { in: [...editableRoles] } }, include: { collaborator: true } });
        if (!user) throw new NotFoundException("Account locale non modificabile in questa attività");
        if (user.collaborator && user.collaborator.tenantId !== tenantId) throw new ForbiddenException("Associazione precedente del professionista da riconciliare");
        if ((user.connectSubject && user.connectSubject !== target.subject) || (user.connectInstallationId && user.connectInstallationId !== team.installationId)) throw new ForbiddenException("Collegamento Connect dell’account non coerente");
        const collaboratorId = body.collaboratorId === undefined ? user.collaborator?.id || null : body.collaboratorId;
        if (collaboratorId) {
          const professional = await tx.collaborator.findFirst({ where: { id: collaboratorId, tenantId, isActive: true } });
          if (!professional) throw new NotFoundException("Professionista non disponibile in questa attività");
          if (professional.userId && professional.userId !== id) throw new ConflictException("Questo professionista è già associato a un altro account");
        }
        if (permissions.some(key => ["appointments.read.own", "appointments.update.own", "dashboard.personal.values.read"].includes(key)) && !collaboratorId) throw new BadRequestException("Associa un professionista per abilitare l’agenda personale");
        if (body.collaboratorId !== undefined) {
          await tx.collaborator.updateMany({ where: { tenantId, userId: id }, data: { userId: null } });
          if (collaboratorId) await tx.collaborator.update({ where: { id: collaboratorId, tenantId }, data: { userId: id } });
        }
        return tx.user.update({ where: { id, tenantId, role: { in: [...editableRoles] } }, data: { role: body.role, permissions, permissionsConfigured: true }, select: { id: true, role: true, permissions: true, permissionsConfigured: true, collaborator: { select: { id: true } } } });
      });
    });
  }
}
