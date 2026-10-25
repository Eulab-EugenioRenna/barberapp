import { ConflictException, ForbiddenException, Injectable, HttpException, NotFoundException, UnauthorizedException } from "@nestjs/common";
import type { ConnectServer, TeamRoleInput } from "@eulab/connect/server";
import { PrismaService } from "../../prisma/prisma.service";
import { connectApplication } from "../../common/connect-application";
import { connectHttpError } from "../../common/connect-http";
import { openConnect } from "../../common/connect-runtime";
import { requireTenantId, requireUser, resolveRequestSession, RequestSession } from "../../common/request-session";

/** Delegation stays in Connect. Tenant and session handles are derived only on the server. */
@Injectable()
export class TeamService {
  constructor(private readonly prisma: PrismaService) {}

  async withTeam<T>(authorization: string | undefined, operation: (client: ConnectServer, token: string, session: RequestSession) => Promise<T>): Promise<T> {
    const session = await resolveRequestSession(this.prisma, authorization);
    requireTenantId(session);
    const user = requireUser(session);
    if (!session.connectSessionId) throw new UnauthorizedException("Accedi tramite Connect");
    const linked = await this.prisma.connectSession.findFirst({
      where: { id: session.connectSessionId, userId: user.id, revokedAt: null, expiresAt: { gt: new Date() } },
      select: { sdkSessionCipher: true },
    });
    if (!linked?.sdkSessionCipher) throw new UnauthorizedException("Ripeti l’accesso Connect");
    try {
      const application = await connectApplication(this.prisma);
      // A rejected business operation must not look like a failed SDK session validation.
      // The published facade revokes its session if a services callback throws.
      const result = await application.services(openConnect(linked.sdkSessionCipher), async (client, token) => {
        try { return { ok: true as const, value: await operation(client, token, session) }; }
        catch (error) { return { ok: false as const, error }; }
      });
      if (!result.ok) throw result.error;
      return result.value;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      // The current SDK exposes HTTP status in this fixed prefix. Never forward its response body.
      const status = error instanceof Error ? error.message.match(/^Connect (\d{3}):/)?.[1] : undefined;
      if (status === "403") throw new ForbiddenException("Operazione fuori dalla delega Connect o dalla licenza");
      if (status === "401") throw new UnauthorizedException("Ripeti l’accesso Connect");
      if (status === "404") throw new NotFoundException("Ruolo o utenza non disponibile in questa installazione");
      if (status === "400" || status === "409") throw new ConflictException("Dati o assegnazioni da verificare in Connect");
      return connectHttpError(error);
    }
  }

  overview(authorization?: string) { return this.withTeam(authorization, (client, token) => client.teamOverview(token)); }
  createRole(authorization: string | undefined, body: TeamRoleInput) { return this.withTeam(authorization, (client, token) => client.createTeamRole(token, body)); }
  updateRole(authorization: string | undefined, id: string, body: TeamRoleInput) { return this.withTeam(authorization, (client, token) => client.updateTeamRole(token, id, body)); }
  removeRole(authorization: string | undefined, id: string) { return this.withTeam(authorization, (client, token) => client.deleteTeamRole(token, id)); }
  assignRoles(authorization: string | undefined, subject: string, roleIds: string[]) { return this.withTeam(authorization, (client, token) => client.setTeamUserRoles(token, subject, roleIds)); }
  revoke(authorization: string | undefined, subject: string) { return this.withTeam(authorization, (client, token) => client.revokeTeamUser(token, subject)); }
  restore(authorization: string | undefined, subject: string) { return this.withTeam(authorization, (client, token) => client.restoreTeamUser(token, subject)); }
}
