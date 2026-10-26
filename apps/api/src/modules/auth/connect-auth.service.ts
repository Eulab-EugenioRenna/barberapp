import { Injectable, OnModuleDestroy, Logger } from "@nestjs/common";
import { createHash } from "node:crypto";
import { PrismaService } from "../../prisma/prisma.service";
import {
  connectApplication,
  closeConnectApplication,
  pruneConnectApplication,
} from "../../common/connect-application";
import {
  connectBrowser,
  applyConnectCookies,
  connectHttpError,
  ConnectRequest,
  AuthResponse,
} from "../../common/connect-http";
import {
  assertActiveUser,
  createLocalSession,
  sessionUserSelect,
  bearerToken,
  tokenHash,
} from "../../common/local-sessions";
import {
  connectReturnUrl,
  openConnect,
  sealConnect,
} from "../../common/connect-runtime";
export type { AuthResponse } from "../../common/connect-http";
export const MIGRATION_CONSENT_VERSION = "2026-10-21-mandatory-v1";

@Injectable()
export class ConnectAuthService implements OnModuleDestroy {
  private readonly logger = new Logger(ConnectAuthService.name);
  private readonly pruneTimer: ReturnType<typeof setInterval>;
  constructor(private readonly prisma: PrismaService) {
    this.pruneTimer = setInterval(() => {
      void pruneConnectApplication(this.prisma).catch(() => undefined);
    }, 5 * 60_000);
    this.pruneTimer.unref();
  }
  async onModuleDestroy() {
    clearInterval(this.pruneTimer);
    await closeConnectApplication(this.prisma);
  }
  private async run<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      return connectHttpError(error);
    }
  }
  async signIn(
    body: { email: string; password?: string },
    request: ConnectRequest,
    response: AuthResponse,
  ) {
    return this.run(async () => {
      const ctx = connectBrowser(request);
      const application = await connectApplication(this.prisma);
      let result: Awaited<ReturnType<typeof application.auth.signIn>>;
      try {
        if (process.env["ALORA_CONNECT_PRESENTER_ID"])
          await application.configuration.sync();
        result = await application.auth.signIn(body, ctx);
      } catch (error) {
        // Email alone never reveals local profile data. Legacy proof is a separate modal step.
        if (!body.password && error && typeof error === "object" &&
            "code" in error && error.code === "invalid_credentials") {
          return { status: "migration_required", onboarding: {
            version: MIGRATION_CONSENT_VERSION, email: body.email,
            firstName: "", lastName: "", challenge: "", needsLegacyVerification: true,
          } };
        }
        if (
          error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === "invalid_context"
        )
          result = {
            status: "administrative_required",
            reason: "source_conflict",
          };
        else throw error;
      }
      if (
        result.status === "administrative_required" ||
        result.status === "configuration_required"
      )
        return {
          status: "migration_required",
          onboarding: {
            version: MIGRATION_CONSENT_VERSION,
            email: body.email,
            firstName: "",
            lastName: "",
            challenge: "",
            feedback:
              result.status === "administrative_required"
                ? "Il collegamento dell’installazione richiede una verifica EULAB."
                : "La pratica richiede il completamento della configurazione di accesso da parte di EULAB.",
          },
        };
      if (result.status === "redirect") {
        applyConnectCookies(response, result.cookies);
        return { status: "connect_redirect", redirectUrl: result.url };
      }
      const user =
        result.status === "migration_required"
          ? await this.prisma.user.findUnique({ where: { email: body.email } })
          : null;
      if (result.status === "migration_required")
        applyConnectCookies(response, result.cookies);
      return {
        status: "migration_required",
        onboarding: {
          version: MIGRATION_CONSENT_VERSION,
          email: body.email,
          firstName: user?.firstName ?? "",
          lastName: user?.lastName ?? "",
          challenge:
            result.status === "migration_required" ? result.challenge : "",
          request: result.request,
        },
      };
    });
  }
  async submit(
    body: {
      challenge: string;
      password: string;
      newConnectPassword?: string;
      accepted: boolean;
      consentVersion: string;
    },
    request: ConnectRequest,
  ) {
    return this.run(async () => {
      const ctx = connectBrowser(request);
      if (!body.accepted) return connectHttpError({ code: "invalid_consent" });
      const result = await (
        await connectApplication(this.prisma)
      ).migration.submit(
        {
          challenge: body.challenge,
          legacyPassword: body.password,
          newConnectPassword: body.newConnectPassword,
          consentVersion: body.consentVersion,
          // One explicit proof = one submission key. Connect reconciles requests by explicit local identity.
          idempotencyKey: createHash("sha256")
            .update("alora-sdk-migration:" + body.challenge)
            .digest("hex"),
        },
        ctx,
      );
      return { status: "migration_pending", request: result };
    });
  }
  async signup(
    body: {
      email: string;
      password: string;
      companyName: string;
      firstName: string;
      lastName: string;
    },
    request: ConnectRequest,
  ) {
    return this.run(async () => ({
      status: "migration_pending",
      request: await (
        await connectApplication(this.prisma)
      ).activation.submit(
        {
          kind: "activation",
          companyName: body.companyName.trim(),
          applicant: {
            email: body.email,
            firstName: body.firstName.trim(),
            lastName: body.lastName.trim(),
          },
          initialPassword: body.password,
          consentVersion: MIGRATION_CONSENT_VERSION,
          idempotencyKey: createHash("sha256")
            .update("activation:" + body.email)
            .digest("hex"),
        },
        connectBrowser(request),
      ),
    }));
  }
  async callback(
    query: { state?: string; code?: string; error?: string; iss?: string },
    request: ConnectRequest,
    response: AuthResponse,
  ) {
    return this.run(async () => {
      const application = await connectApplication(this.prisma);
      const result = await application.auth.callback(
        { ...query, state: query.state ?? "" },
        connectBrowser(request, true),
      ).catch((error: unknown) => {
        // Only fixed SDK classifications: no query, error message, tokens or identity.
        const code = error && typeof error === "object" && "code" in error
          ? error.code : "unknown";
        const stage = error && typeof error === "object" && "callbackStage" in error
          ? error.callbackStage : "unknown";
        const detail = error && typeof error === "object" && "authorizationDetail" in error
          ? error.authorizationDetail : "unknown";
        const details = ["http_401", "http_403", "http_other", "transport", "login_denied", "app_mismatch", "installation_mismatch", "subject_mismatch", "local_user_mismatch"];
        const codes = ["invalid_configuration", "invalid_flow", "invalid_context", "access_denied", "provider_unavailable"];
        const stages = ["flow", "token_exchange", "id_token", "context", "authorization", "handoff"];
        this.logger.warn(`[connect-callback] stage=${stages.includes(String(stage)) ? stage : "unknown"} code=${codes.includes(String(code)) ? code : "unknown"} detail=${details.includes(String(detail)) ? detail : "unknown"}`);
        throw error;
      });
      applyConnectCookies(response, result.cookies);
      const url = new URL(connectReturnUrl());
      // The handoff stays in the fragment, never in a server request or referrer query.
      const fragment = new URLSearchParams(
        url.hash.slice(1).split("?")[1] ?? "",
      );
      fragment.set("alora_connect", result.handoff);
      url.hash =
        (url.hash.slice(1).split("?")[0] || "/login") +
        "?" +
        fragment.toString();
      return url.href;
    });
  }
  async exchange(
    handoff: string,
    request: ConnectRequest,
    response: AuthResponse,
  ) {
    return this.run(async () => {
      const result = await (
        await connectApplication(this.prisma)
      ).auth.exchange(handoff, connectBrowser(request));
      // Compatibility adapter: ALORA access/refresh remain distinct opaque handles. Provider state belongs only to the SDK.
      const tokens = await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.findUnique({
          where: { id: result.session.profile.localUserId },
          select: { ...sessionUserSelect, connectInstallationId: true },
        });
        assertActiveUser(user);
        if (
          !user ||
          user.tenantId !== result.session.profile.localTenantId ||
          user.connectSubject !== result.session.subject ||
          !user.connectInstallationId
        )
          return connectHttpError({ code: "provision_conflict" });
        const linked = await tx.connectSession.create({
          data: {
            userId: user.id,
            installationId: user.connectInstallationId,
            accessCipher: "",
            sdkSessionCipher: sealConnect(result.session.sessionId),
            expiresAt: new Date(result.session.expiresAt),
          },
        });
        const tokens = await createLocalSession(
          tx,
          user.id,
          undefined,
          new Date(result.session.expiresAt),
          linked.id,
        );
        await tx.auditLog.create({
          data: {
            tenantId: user.tenantId,
            actorUserId: user.id,
            actorRole: user.role,
            action: "auth.connect.login",
            entityType: "session",
          },
        });
        return tokens;
      });
      applyConnectCookies(response, result.cookies);
      return tokens;
    });
  }
  async logoutProvider(
    authorization: string | undefined,
    request: ConnectRequest,
    response: AuthResponse,
  ) {
    return this.run(async () => {
      const ctx = connectBrowser(request),
        token = bearerToken(authorization);
      if (!token) return connectHttpError({ code: "session_expired" });
      const local = await this.prisma.localSession.findUnique({
        where: { accessHash: tokenHash(token) },
        include: { connectSession: true },
      });
      if (!local?.connectSession?.sdkSessionCipher)
        return { providerRevoked: null };
      const result = await (
        await connectApplication(this.prisma)
      ).auth.logout(openConnect(local.connectSession.sdkSessionCipher), ctx);
      applyConnectCookies(response, result.cookies);
      return { providerRevoked: result.providerRevoked };
    });
  }
}
