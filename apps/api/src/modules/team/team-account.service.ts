import { BadRequestException, ConflictException, ForbiddenException, HttpException, Injectable, NotFoundException, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { hash } from "bcrypt";
import { Prisma } from "@prisma/client";
import type { ApplicationTeamUserInput, ApplicationTeamUserResult } from "@eulab/connect/application";
import { connectHttpError } from "../../common/connect-http";
import { canUseLocalFunction } from "../../common/function-catalog";
import { requireTenantId, requireUser } from "../../common/request-session";
import { PrismaService } from "../../prisma/prisma.service";
import { TeamService } from "./team.service";
import { assignProfessional } from "./team-local-policy.service";

export interface CreateTeamAccountInput {
  id: string; email: string; firstName: string; lastName: string;
  role: "manager" | "reception" | "collaborator"; permissions: string[]; roleIds: string[];
  collaboratorId?: string | null; initialPassword?: string;
}
const ownKeys = ["appointments.read.own", "appointments.update.own", "dashboard.personal.values.read"];
const sameSet = (a: string[], b: string[]) => JSON.stringify([...new Set(a)].sort()) === JSON.stringify([...new Set(b)].sort());
const accountSelect = { id: true, email: true, firstName: true, lastName: true, role: true, permissions: true, collaborator: { select: { id: true } } } as const;
const intentInclude = { user: { select: { ...accountSelect, tenantId: true, isActive: true, connectSubject: true, connectInstallationId: true } } } as const;
type Intent = Prisma.TeamAccountIntentGetPayload<{ include: typeof intentInclude }>;

@Injectable()
export class TeamAccountService {
  constructor(private readonly prisma: PrismaService, private readonly team: TeamService) {}
  private async context(authorization?: string) {
    return this.team.withTeam(authorization, async (client, token, session) => {
      const actor = requireUser(session), tenantId = requireTenantId(session);
      if (!canUseLocalFunction(actor, "team.manage")) throw new ForbiddenException();
      const overview = await client.teamOverview(token);
      if (!overview.canManage) throw new ForbiddenException("Gestione squadra non delegata");
      const sourceId = process.env["ALORA_CONNECT_SOURCE_ID"];
      if (!sourceId) throw new ServiceUnavailableException("Sorgente Connect non configurata");
      const binding = await this.prisma.connectTenantBinding.findUnique({ where: { tenantId }, select: { installationId: true, customerId: true } });
      if (!binding || binding.installationId !== overview.installationId || binding.customerId !== overview.customerId) throw new ForbiddenException("Installazione Connect non coerente con l’attività");
      return { actor, tenantId, overview, sourceId };
    });
  }
  private validate(context: Awaited<ReturnType<TeamAccountService["context"]>>, input: Pick<CreateTeamAccountInput, "role" | "permissions" | "roleIds" | "collaboratorId">) {
    const { overview, actor } = context;
    if (!["manager", "reception", "collaborator"].includes(input.role) || !input.roleIds.length || new Set(input.roleIds).size !== input.roleIds.length) throw new BadRequestException("Seleziona ruoli validi");
    const delegated = new Set(overview.delegation.map(fn => fn.key)), licensed = new Set(overview.functions.filter(fn => fn.delegable).map(fn => fn.key));
    const roles = input.roleIds.map(id => overview.roles.find(role => role.id === id));
    if (roles.some(role => !role || role.permissions.some(key => !delegated.has(key) || !licensed.has(key)))) throw new ForbiddenException("Ruolo fuori dalla licenza o dalla delega");
    const central = new Set(roles.flatMap(role => role!.permissions));
    if (input.permissions.some(key => !central.has(key) || !canUseLocalFunction(actor, key) || (input.role === "collaborator" && !ownKeys.includes(key)))) throw new ForbiddenException("Visibilità locale fuori dai permessi concedibili");
    if (input.permissions.some(key => ownKeys.includes(key)) && !input.collaboratorId) throw new BadRequestException("Associa un professionista per abilitare l’agenda personale");
  }
  async pending(authorization?: string) {
    const context = await this.context(authorization);
    const rows = await this.prisma.teamAccountIntent.findMany({ where: { tenantId: context.tenantId, completedAt: null }, include: intentInclude, orderBy: { createdAt: "asc" } });
    return rows.map(row => ({ id: row.userId, email: row.user.email, firstName: row.user.firstName, lastName: row.user.lastName, role: row.user.role, permissions: row.user.permissions, roleIds: row.roleIds, collaboratorId: row.user.collaborator?.id || null }));
  }
  async create(authorization: string | undefined, body: CreateTeamAccountInput) {
    const context = await this.context(authorization);
    this.validate(context, body);
    let intent: Intent;
    try {
      intent = await this.prisma.$transaction(async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"team-policy:" + context.tenantId}, 0))`;
        const current = await tx.teamAccountIntent.findUnique({ where: { userId: body.id }, include: intentInclude });
        if (current) {
          if (current.tenantId !== context.tenantId || current.user.email !== body.email || current.user.firstName !== body.firstName || current.user.lastName !== body.lastName || current.user.role !== body.role || !sameSet(current.user.permissions, body.permissions) || !sameSet(current.roleIds, body.roleIds) || (current.user.collaborator?.id || null) !== (body.collaboratorId || null)) throw new ConflictException("ID di creazione già utilizzato: riprendi il profilo salvato");
          return current;
        }
        await tx.user.create({ data: { id: body.id, tenantId: context.tenantId, email: body.email, firstName: body.firstName, lastName: body.lastName, role: body.role, permissions: [...new Set(body.permissions)].sort(), permissionsConfigured: true, isActive: false, passwordHash: await hash(randomBytes(48).toString("base64url"), 10) } });
        if (body.collaboratorId) await assignProfessional(tx, context.tenantId, body.id, body.collaboratorId);
        const created = await tx.teamAccountIntent.create({ data: { userId: body.id, tenantId: context.tenantId, sourceId: context.sourceId, appId: context.overview.appId, installationId: context.overview.installationId, customerId: context.overview.customerId, roleIds: [...body.roleIds].sort() }, include: intentInclude });
        await tx.auditLog.create({ data: { tenantId: context.tenantId, actorUserId: context.actor.id, actorRole: context.actor.role, action: "team.account.requested", entityType: "user", entityId: body.id } });
        return created;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new ConflictException("Email o ID già utilizzati: verifica il profilo esistente");
      throw error;
    }
    return this.provision(authorization, context, intent, body.initialPassword);
  }
  async resume(authorization: string | undefined, id: string, initialPassword?: string) {
    const context = await this.context(authorization);
    const intent = await this.prisma.teamAccountIntent.findFirst({ where: { userId: id, tenantId: context.tenantId }, include: intentInclude });
    if (!intent) throw new NotFoundException("Creazione account non disponibile in questa attività");
    return this.provision(authorization, context, intent, initialPassword);
  }
  private async provision(authorization: string | undefined, context: Awaited<ReturnType<TeamAccountService["context"]>>, intent: Intent, initialPassword?: string) {
    const { user } = intent;
    if (intent.tenantId !== context.tenantId || user.tenantId !== context.tenantId || intent.sourceId !== context.sourceId || intent.appId !== context.overview.appId || intent.installationId !== context.overview.installationId || intent.customerId !== context.overview.customerId) throw new ForbiddenException("Integrazione cambiata: creazione da riconciliare");
    if (intent.completedAt) return { id: user.id, completed: true, ssoSetupRequired: intent.ssoSetupRequired };
    if (user.isActive || user.connectSubject || user.connectInstallationId) throw new ConflictException("Profilo modificato: creazione da riconciliare");
    this.validate(context, { role: user.role as CreateTeamAccountInput["role"], permissions: user.permissions, roleIds: intent.roleIds, collaboratorId: user.collaborator?.id || null });
    if (user.collaborator && !await this.prisma.collaborator.findFirst({ where: { id: user.collaborator.id, tenantId: context.tenantId, userId: user.id, isActive: true }, select: { id: true } })) throw new ConflictException("Professionista non più disponibile: creazione da riconciliare");
    const input: ApplicationTeamUserInput = { localUser: { localUserId: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, role: user.role as CreateTeamAccountInput["role"], permissions: user.permissions }, roleIds: intent.roleIds, initialPasswordTemporary: true, ...(initialPassword === undefined ? {} : { initialPassword }) };
    let result: ApplicationTeamUserResult;
    try { result = await this.team.createUser(authorization, input); }
    catch (error) { return this.failure(error, user.id); }
    if (!result.applicationAccess || typeof result.subject !== "string" || !result.subject || !Array.isArray(result.roleIds) || result.localUserId !== user.id || result.localTenantId !== context.tenantId || result.sourceId !== intent.sourceId || result.appId !== intent.appId || result.installationId !== intent.installationId || result.customerId !== intent.customerId || !sameSet(result.roleIds, intent.roleIds)) throw new ConflictException({ code: "account_review_required", accountId: user.id, message: "Risposta Connect non coerente: verifica il profilo prima di proseguire" });
    try {
      return await this.prisma.$transaction(async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"team-policy:" + context.tenantId}, 0))`;
        const binding = await tx.connectTenantBinding.findUnique({ where: { tenantId: context.tenantId }, select: { installationId: true, customerId: true } });
        if (!binding || binding.installationId !== intent.installationId || binding.customerId !== intent.customerId) throw new ConflictException();
        const current = await tx.teamAccountIntent.findFirst({ where: { userId: user.id, tenantId: context.tenantId }, include: intentInclude });
        if (!current) throw new ConflictException();
        if (current.completedAt) return { id: user.id, completed: true, ssoSetupRequired: current.ssoSetupRequired };
        if (current.user.isActive || current.user.connectSubject || current.user.connectInstallationId || current.user.role !== user.role || current.user.email !== user.email || current.user.firstName !== user.firstName || current.user.lastName !== user.lastName || !sameSet(current.user.permissions, user.permissions) || current.user.collaborator?.id !== user.collaborator?.id) throw new ConflictException();
        await tx.user.update({ where: { id: user.id, tenantId: context.tenantId, isActive: false, connectSubject: null, connectInstallationId: null }, data: { connectSubject: result.subject, connectInstallationId: result.installationId, connectActivatedAt: new Date(), isActive: true } });
        await tx.teamAccountIntent.update({ where: { userId: user.id }, data: { completedAt: new Date(), ssoSetupRequired: result.ssoSetupRequired } });
        await tx.auditLog.create({ data: { tenantId: context.tenantId, actorUserId: context.actor.id, actorRole: context.actor.role, action: "team.account.created", entityType: "user", entityId: user.id } });
        return { id: user.id, completed: true, ssoSetupRequired: result.ssoSetupRequired };
      });
    } catch { throw new ServiceUnavailableException({ code: "account_outcome_uncertain", accountId: user.id, message: "Connect ha risposto ma la conferma locale è da verificare. Riprendi lo stesso profilo senza creare un altro account" }); }
  }
  private failure(error: unknown, accountId: string): never {
    if (error instanceof HttpException) throw error;
    if (error instanceof Error && error.name === "ConnectApplicationError") return connectHttpError(error);
    if (error instanceof Error && error.name === "ConnectApiError" && "status" in error) {
      if (error.status === 401) throw new UnauthorizedException("Ripeti l’accesso Connect e riprendi lo stesso profilo");
      if (error.status === 403) throw new ForbiddenException("Creazione fuori dalla licenza o dalla delega Connect");
    }
    const code = error instanceof Error && error.name === "ConnectApiError" && "code" in error ? error.code : undefined;
    const messages: Record<string, string> = {
      mirror_password_rejected: "Password rifiutata dal provider. Correggila e riprendi lo stesso profilo",
      mirror_identity_conflict: "Identità già presente senza un collegamento compatibile: richiedi verifica",
      mirror_provider_configuration_required: "Il provider Connect richiede la configurazione degli attributi di recupero",
    };
    if (code === "mirror_password_rejected") throw new BadRequestException({ code, accountId, message: messages[code] });
    if (typeof code === "string" && ["mirror_identity_conflict", "mirror_profile_conflict", "mirror_mapping_conflict", "mirror_review_required", "mirror_mapping_disabled", "mirror_identity_suspended", "mirror_access_revoked"].includes(code)) throw new ConflictException({ code, accountId, message: messages[code] || "Profilo o accesso da verificare in Connect. La creazione non riattiva account sospesi o revocati" });
    throw new ServiceUnavailableException({ code: "account_outcome_uncertain", accountId, message: typeof code === "string" && messages[code] || "Esito Connect da verificare. Riprendi esplicitamente lo stesso profilo, senza creare un altro account" });
  }
}
