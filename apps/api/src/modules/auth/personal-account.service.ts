import {
  ForbiddenException, HttpException, Injectable, NotFoundException, ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import type { ConnectServer } from "@eulab/connect/server";
import type { PersonalAccount, PersonalNotices, PersonalSecurity, PersonalSessionList } from "../../common/personal-account";
import { PrismaService } from "../../prisma/prisma.service";
import { connectApplication } from "../../common/connect-application";
import { connectHttpError } from "../../common/connect-http";
import { checkedConnectUrl, connectApplicationConfig, openConnect } from "../../common/connect-runtime";
import { requireUser, resolveRequestSession } from "../../common/request-session";

/** Self service never accepts a subject, tenant or provider token from the browser. */
@Injectable()
export class PersonalAccountService {
  constructor(private readonly prisma: PrismaService) {}

  private async context(authorization?: string) {
    const session = await resolveRequestSession(this.prisma, authorization);
    const user = requireUser(session);
    if (user.technicalAccess || user.role === "platform_admin")
      throw new ForbiddenException("Usa la tua identità personale Connect");
    if (!session.connectSessionId) throw new UnauthorizedException("Accedi tramite Connect");
    const linked = await this.prisma.connectSession.findFirst({
      where: { id: session.connectSessionId, userId: user.id, revokedAt: null, expiresAt: { gt: new Date() } },
      select: { sdkSessionCipher: true, user: { select: { connectSubject: true } } },
    });
    if (!linked?.sdkSessionCipher || !linked.user.connectSubject) throw new UnauthorizedException("Ripeti l’accesso Connect");
    return { user, subject: linked.user.connectSubject, connectSessionId: session.connectSessionId,
      handle: openConnect(linked.sdkSessionCipher), application: await connectApplication(this.prisma) };
  }

  private async withAccount<T>(authorization: string | undefined, operation: (client: ConnectServer, token: string, context: Awaited<ReturnType<PersonalAccountService["context"]>>) => Promise<T>): Promise<T> {
    const context = await this.context(authorization);
    try {
      return await context.application.services(context.handle, (client, token) => operation(client, token, context));
    } catch (error) {
      if (error instanceof HttpException) throw error;
      const status = error instanceof Error ? error.message.match(/^Connect (\d{3}):/)?.[1] : undefined;
      if (status === "404") throw new NotFoundException("Elemento personale non disponibile");
      if (status === "403") throw new ForbiddenException("Operazione personale non disponibile in Connect");
      if (status === "401") throw new UnauthorizedException("Ripeti l’accesso Connect");
      return connectHttpError(error);
    }
  }

  profile(authorization?: string): Promise<PersonalAccount> {
    return this.withAccount(authorization, async (_client, _token, { application, user }) => {
      // Approved presenter configuration is the existing source of truth, including installations without env issuer.
      const result = await application.source.configuration();
      const global = connectApplicationConfig();
      if (result.status !== "ready" || result.configuration.sourceId !== process.env["ALORA_CONNECT_SOURCE_ID"] ||
          result.configuration.appId !== application.catalog.appId || result.configuration.redirectUri !== global.callbackUrl)
        throw new ServiceUnavailableException("Configurazione account SSO da verificare");
      const issuer = new URL(checkedConnectUrl(result.configuration.issuer));
      if (issuer.search || issuer.hash) throw new ServiceUnavailableException("Provider SSO non valido");
      // Native Keycloak account console owns profile/password/MFA; no credential crosses ALORA.
      const account = new URL(issuer.href.replace(/\/$/, "") + "/account/");
      account.searchParams.set("referrer", result.configuration.clientId);
      account.searchParams.set("referrer_uri", global.returnUrl);
      return { profile: { firstName: user.firstName, lastName: user.lastName, email: user.email }, accountUrl: account.href };
    });
  }

  security(authorization?: string): Promise<PersonalSecurity> {
    return this.withAccount(authorization, async (client, token) => {
      const value = await client.accountSecurity(token);
      if (typeof value?.totp !== "boolean" || typeof value.emailVerified !== "boolean" ||
          !["auto", "totp", "email"].includes(value.preferredMethod) || !Array.isArray(value.requiredActions) ||
          !Array.isArray(value.authenticators) || !Array.isArray(value.trustedDevices))
        throw new ServiceUnavailableException("Stato sicurezza SSO non valido");
      const credential = (item: { id: string; name: string; createdAt?: number }) => ({ id: item.id, name: item.name, createdAt: item.createdAt ?? null });
      return { totp: value.totp, emailVerified: value.emailVerified, preferredMethod: value.preferredMethod,
        requiredActions: value.requiredActions.filter((item: unknown) => typeof item === "string"),
        authenticators: value.authenticators.map(credential),
        trustedDevices: value.trustedDevices.map((item: { id: string; name: string; createdAt?: number; expiresAt?: number }) => ({ ...credential(item), expiresAt: item.expiresAt ?? null })) };
    });
  }

  private async ownSessions(client: ConnectServer, token: string, subject: string): Promise<PersonalSessionList> {
    // Connect's default list can be global for an admin identity: always specify the authenticated subject.
    const value = await client.request("/v1/sessions?" + new URLSearchParams({ subject }), "GET", undefined, token);
    if (!Array.isArray(value?.sessions) || typeof value.truncated !== "boolean" ||
        value.sessions.some((item: { subject?: string }) => item.subject !== subject))
      throw new ServiceUnavailableException("Elenco sessioni personali non valido");
    return { truncated: value.truncated, sessions: value.sessions.map((item: { id: string; ipAddress: string; startedAt: number; lastAccess: number; clients: string[]; current: boolean }) => ({
      id: item.id, ipAddress: item.ipAddress, startedAt: item.startedAt, lastAccess: item.lastAccess,
      clients: item.clients, current: item.current,
    })) };
  }

  sessions(authorization?: string) {
    return this.withAccount(authorization, (client, token, { subject }) => this.ownSessions(client, token, subject));
  }

  private async revokeLocal(userId: string, connectSessionId?: string) {
    await this.prisma.$transaction(async (tx) => {
      // Same user lock as refresh: a concurrent refresh cannot recreate a revoked local family.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"user:" + userId}, 0))`;
      const now = new Date();
      await tx.localSession.updateMany({ where: { userId, ...(connectSessionId ? { connectSessionId } : {}), revokedAt: null }, data: { revokedAt: now } });
      await tx.connectSession.updateMany({ where: { userId, ...(connectSessionId ? { id: connectSessionId } : {}), revokedAt: null }, data: { revokedAt: now } });
    });
  }

  logoutSession(authorization: string | undefined, id: string) {
    return this.withAccount(authorization, async (client, token, context) => {
      const own = (await this.ownSessions(client, token, context.subject)).sessions.find(item => item.id === id);
      if (!own) throw new NotFoundException("Sessione personale non trovata");
      try {
        const value = await client.logoutSession(token, id);
        if (value?.loggedOut !== true) throw new ServiceUnavailableException("Esito disconnessione da verificare");
        return { loggedOut: true, current: own.current };
      }
      finally { if (own.current) await this.revokeLocal(context.user.id, context.connectSessionId); }
    });
  }

  logoutAll(authorization?: string) {
    return this.withAccount(authorization, async (client, token, { user }) => {
      try {
        const value = await client.logoutAllSessions(token);
        if (value?.loggedOut !== true) throw new ServiceUnavailableException("Esito disconnessione da verificare");
        return { loggedOut: true };
      }
      finally { await this.revokeLocal(user.id); }
    });
  }

  async revokeDevice(authorization: string | undefined, id: string) {
    let requested = false;
    try {
      return await this.withAccount(authorization, async (client, token, { user }) => {
        const security = await client.accountSecurity(token);
        if (!Array.isArray(security?.trustedDevices)) throw new ServiceUnavailableException("Elenco dispositivi non disponibile");
        if (!security.trustedDevices.some((device: { id?: string } | null) => device?.id === id))
          throw new NotFoundException("Dispositivo personale non trovato");
        let closeLocal = true;
        requested = true;
        try {
          // Provider ownership checks remain authoritative, including changes after this read.
          const value = await client.revokeTrustedDevice(token, id);
          if (value?.revoked !== true || typeof value.sessionsLoggedOut !== "boolean") throw new ServiceUnavailableException("Esito revoca da verificare");
          return { revoked: true, sessionsLoggedOut: value.sessionsLoggedOut };
        } catch (error) {
          const status = error instanceof Error ? error.message.match(/^Connect (\d{3}):/)?.[1] : undefined;
          if (status === "403" || status === "404") closeLocal = false;
          throw error;
        } finally { if (closeLocal) await this.revokeLocal(user.id); }
      });
    } catch (error) {
      if (!requested && error instanceof ServiceUnavailableException)
        throw new ServiceUnavailableException({ code: "account_operation_not_started", message: "Verifica dispositivo non disponibile. Nessuna revoca richiesta." });
      throw error;
    }
  }

  notices(authorization?: string): Promise<PersonalNotices> {
    return this.withAccount(authorization, async (client, token) => {
      const value = await client.notifications(token, { limit: 10 });
      if (!Array.isArray(value?.items) || !Number.isInteger(value.unreadCount))
        throw new ServiceUnavailableException("Notifiche personali non disponibili");
      return { unreadCount: value.unreadCount, items: value.items.map((item: PersonalNotices["items"][number]) => ({
        id: item.id, title: item.title, body: item.body, created_at: item.created_at, read_at: item.read_at,
      })) };
    });
  }
}
