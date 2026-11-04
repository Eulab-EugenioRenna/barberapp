import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { randomBytes } from "node:crypto";

import { connectHttpError } from "../../common/connect-http";
import {
  assertTechnicalOperator,
  checkTechnicalOperator,
  createConnectServer,
  isConnectAuthError,
  TECHNICAL_HANDOFF_TTL_MS,
  TECHNICAL_SCOPE,
  technicalHandoffHash,
  technicalSessionExpiresAt,
} from "../../common/connect-technical";
import {
  connectReturnUrl,
  loadConnectConfigByInstallation,
  sealConnect,
} from "../../common/connect-runtime";
import { createLocalSession } from "../../common/local-sessions";
import { PrismaService } from "../../prisma/prisma.service";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HANDOFF = /^[A-Za-z0-9_-]{43}$/;

interface TechnicalRedeem {
  subject: string;
  scope: string;
  installationId: string;
  localUserId: string | null;
  localSubject: string | null;
  accessToken: string;
}

@Injectable()
export class ConnectTechnicalService {
  private readonly logger = new Logger(ConnectTechnicalService.name);
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Documents the outcome of a browser POST without ever rendering a provider
   * error or the one-use ticket.
   */
  failureUrl(): string {
    return this.returnUrl({ alora_technical_error: "1" });
  }

  async start(ticket: string, installationId: string): Promise<string> {
    if (!HANDOFF.test(ticket) || !UUID.test(installationId))
      throw new UnauthorizedException("Ticket non valido o scaduto");
    const config = await loadConnectConfigByInstallation(
      this.prisma,
      installationId,
    );
    if (!config) throw new NotFoundException("Installazione non disponibile");
    const server = await createConnectServer({
      apiUrl: config.apiUrl,
      installationId: config.installationId,
      secret: config.secret,
      requestTimeoutMs: 8_000,
    });
    let redeemed: TechnicalRedeem;
    try {
      redeemed = await server.redeemTechnicalTicket(ticket);
    } catch (error) {
      if (isConnectAuthError(error))
        throw new UnauthorizedException("Ticket non valido o scaduto");
      return connectHttpError(error);
    }
    if (
      redeemed?.scope !== TECHNICAL_SCOPE ||
      redeemed.installationId !== installationId ||
      typeof redeemed.subject !== "string" ||
      !redeemed.subject ||
      typeof redeemed.localUserId !== "string" ||
      !redeemed.localUserId ||
      typeof redeemed.localSubject !== "string" ||
      !redeemed.localSubject ||
      typeof redeemed.accessToken !== "string" ||
      !redeemed.accessToken
    )
      throw new ForbiddenException("Ticket non valido per questo profilo");
    const user = await this.targetUser(
      redeemed.localUserId,
      config.installationId,
      config.tenantId,
      redeemed.localSubject,
    );
    try {
      await checkTechnicalOperator(
        server,
        config.installationId,
        redeemed.accessToken,
      );
    } catch (error) {
      if (isConnectAuthError(error))
        throw new UnauthorizedException("Operatore EULab non più autorizzato");
      return connectHttpError(error);
    }
    const expiresAt = technicalSessionExpiresAt(redeemed.accessToken);
    if (expiresAt.getTime() <= Date.now() + 30_000)
      throw new UnauthorizedException("Sessione operatore troppo breve");
    const handoff = randomBytes(32).toString("base64url");
    const grant = await this.prisma.connectTechnicalAccess.create({
      data: {
        handoffHash: technicalHandoffHash(handoff),
        installationId: config.installationId,
        targetUserId: user.id,
        targetSubject: redeemed.localSubject,
        operatorSubject: redeemed.subject,
        operatorTokenCipher: sealConnect(redeemed.accessToken),
        handoffExpiresAt: new Date(Date.now() + TECHNICAL_HANDOFF_TTL_MS),
        expiresAt,
      },
    });
    await this.prisma.auditLog.create({
      data: {
        tenantId: user.tenantId,
        actorUserId: user.id,
        actorRole: user.role,
        action: "auth.connect.access_as_requested",
        entityType: "session",
        entityId: grant.id,
        after: {
          installationId: config.installationId,
          operatorSubject: redeemed.subject,
          targetUserId: user.id,
          targetSubject: redeemed.localSubject,
        },
      },
    });
    this.logger.log("Accesso come profilo locale preparato");
    return this.returnUrl({ alora_technical: handoff });
  }

  async exchange(handoff: string) {
    if (!HANDOFF.test(handoff))
      throw new UnauthorizedException("Accesso come profilo scaduto");
    const grant = await this.prisma.connectTechnicalAccess.findUnique({
      where: { handoffHash: technicalHandoffHash(handoff) },
    });
    if (
      !grant ||
      grant.exchangedAt ||
      grant.revokedAt ||
      grant.handoffExpiresAt <= new Date() ||
      grant.expiresAt <= new Date()
    )
      throw new UnauthorizedException("Accesso come profilo scaduto");
    await assertTechnicalOperator(this.prisma, grant);
    const config = await loadConnectConfigByInstallation(
      this.prisma,
      grant.installationId,
    );
    if (!config) throw new ForbiddenException("Installazione non più collegata");
    const user = await this.targetUser(
      grant.targetUserId,
      grant.installationId,
      config.tenantId,
      grant.targetSubject,
    );
    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.connectTechnicalAccess.updateMany({
        where: {
          id: grant.id,
          exchangedAt: null,
          revokedAt: null,
          handoffExpiresAt: { gt: new Date() },
          expiresAt: { gt: new Date() },
        },
        data: { exchangedAt: new Date() },
      });
      if (claimed.count !== 1)
        throw new UnauthorizedException("Accesso come profilo scaduto");
      const tokens = await createLocalSession(
        tx,
        user.id,
        undefined,
        grant.expiresAt,
        null,
        { id: grant.id, expiresAt: grant.expiresAt },
      );
      await tx.auditLog.create({
        data: {
          tenantId: user.tenantId,
          actorUserId: user.id,
          actorRole: user.role,
          action: "auth.connect.access_as",
          entityType: "session",
          entityId: grant.id,
          after: {
            installationId: grant.installationId,
            operatorSubject: grant.operatorSubject,
            targetUserId: user.id,
            targetSubject: grant.targetSubject,
          },
        },
      });
      return tokens;
    });
  }

  private async targetUser(
    userId: string,
    installationId: string,
    tenantId: string,
    targetSubject: string,
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        tenantId: true,
        role: true,
        isActive: true,
        connectSubject: true,
        connectInstallationId: true,
        tenant: { select: { isActive: true, isSuspended: true } },
      },
    });
    if (
      !user ||
      !user.isActive ||
      user.role === "platform_admin" ||
      user.tenantId !== tenantId ||
      !user.tenant?.isActive ||
      user.tenant.isSuspended
    )
      throw new ForbiddenException("Profilo locale non disponibile");
    if (
      (user.connectSubject && user.connectSubject !== targetSubject) ||
      (user.connectInstallationId &&
        user.connectInstallationId !== installationId)
    )
      throw new ForbiddenException("Collegamento Connect del profilo non coerente");
    return user;
  }

  private returnUrl(fragmentValue: Record<string, string>): string {
    const url = new URL(connectReturnUrl());
    const fragment = new URLSearchParams(
      url.hash.slice(1).split("?")[1] ?? "",
    );
    for (const [key, value] of Object.entries(fragmentValue))
      fragment.set(key, value);
    url.hash =
      (url.hash.slice(1).split("?")[0] || "/login") +
      "?" +
      fragment.toString();
    return url.href;
  }
}
