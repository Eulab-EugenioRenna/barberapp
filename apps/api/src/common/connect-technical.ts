import { UnauthorizedException } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import type { ConnectServer } from "@eulab/connect/server";
import { createHash } from "node:crypto";

import { connectHttpError } from "./connect-http";
import {
  loadConnectConfigByInstallation,
  openConnect,
} from "./connect-runtime";

// The package is ESM; the API compiles to CommonJS. Load it dynamically at the
// call site exactly like the ConnectApplication store does.
const loadServer = new Function(
  "return import('@eulab/connect/server')",
) as () => Promise<typeof import("@eulab/connect/server")>;

export async function createConnectServer(config: {
  apiUrl: string;
  installationId: string;
  secret: string;
  requestTimeoutMs?: number;
}): Promise<ConnectServer> {
  const { ConnectServer } = await loadServer();
  return new ConnectServer(config);
}

export function isConnectAuthError(error: unknown): boolean {
  return (
    !!error &&
    typeof error === "object" &&
    "status" in error &&
    (error.status === 401 || error.status === 403)
  );
}

export const TECHNICAL_SCOPE = "eulab-access-as";
export const TECHNICAL_HANDOFF_TTL_MS = 60_000;
export const TECHNICAL_SESSION_TTL_MS = 5 * 60_000;
/** A successful operator check is reused briefly; failures are never cached. */
const OPERATOR_CHECK_TTL_MS = 10_000;

export type TechnicalGrant = {
  id: string;
  installationId: string;
  targetSubject: string;
  operatorSubject: string;
  operatorTokenCipher: string;
  handoffExpiresAt: Date;
  expiresAt: Date;
  exchangedAt: Date | null;
  revokedAt: Date | null;
};

const operatorChecks = new Map<
  string,
  { expiresAt: number; operatorSubject: string }
>();
const operatorChecksInFlight = new Map<string, Promise<void>>();

export function technicalHandoffHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Session lifetime is the shorter of the five-minute policy and the operator token. */
export function technicalSessionExpiresAt(
  operatorAccessToken: string,
  now = Date.now(),
): Date {
  const policy = new Date(now + TECHNICAL_SESSION_TTL_MS);
  try {
    const payload = JSON.parse(
      Buffer.from(
        operatorAccessToken.split(".")[1] ?? "",
        "base64url",
      ).toString("utf8"),
    ) as { exp?: unknown };
    if (typeof payload.exp !== "number" || !Number.isFinite(payload.exp))
      return policy;
    return new Date(Math.min(policy.getTime(), payload.exp * 1000));
  } catch {
    return policy;
  }
}

export function assertTechnicalGrantActive(
  grant: TechnicalGrant | null,
  now = new Date(),
): asserts grant is TechnicalGrant {
  if (
    !grant ||
    grant.revokedAt ||
    !grant.exchangedAt ||
    grant.expiresAt <= now
  )
    throw new UnauthorizedException("Accesso come profilo scaduto o revocato");
}

export async function checkTechnicalOperator(
  server: ConnectServer,
  installationId: string,
  operatorAccessToken: string,
): Promise<void> {
  const context = await server.request<{ id?: string; admin?: boolean }>(
    "/v1/context",
    "GET",
    undefined,
    operatorAccessToken,
  );
  if (context?.id !== installationId || context.admin !== true)
    throw new UnauthorizedException("Operatore EULab non più autorizzato");
}

/**
 * Rechecks the EULab operator directly with Connect. The operator access token
 * is decrypted only for the outbound request and never returned to a browser.
 */
export async function assertTechnicalOperator(
  prisma: PrismaClient,
  grant: TechnicalGrant,
): Promise<void> {
  if (grant.revokedAt || grant.expiresAt <= new Date())
    throw new UnauthorizedException("Accesso come profilo scaduto o revocato");
  const cached = operatorChecks.get(grant.id);
  if (
    cached &&
    cached.expiresAt > Date.now() &&
    cached.operatorSubject === grant.operatorSubject
  )
    return;
  const pending = operatorChecksInFlight.get(grant.id);
  if (pending) return pending;
  const check = (async () => {
    try {
      const config = await loadConnectConfigByInstallation(
        prisma,
        grant.installationId,
      );
      if (!config) throw new UnauthorizedException("Installazione non più collegata");
      const server = await createConnectServer({
        apiUrl: config.apiUrl,
        installationId: config.installationId,
        secret: config.secret,
        requestTimeoutMs: 5_000,
      });
      await checkTechnicalOperator(
        server,
        grant.installationId,
        openConnect(grant.operatorTokenCipher),
      );
      operatorChecks.set(grant.id, {
        expiresAt: Date.now() + OPERATOR_CHECK_TTL_MS,
        operatorSubject: grant.operatorSubject,
      });
    } catch (error) {
      operatorChecks.delete(grant.id);
      if (isConnectAuthError(error))
        throw new UnauthorizedException("Operatore EULab non più autorizzato");
      return connectHttpError(error);
    }
  })();
  operatorChecksInFlight.set(grant.id, check);
  try {
    await check;
  } finally {
    operatorChecksInFlight.delete(grant.id);
  }
}

export function forgetTechnicalOperator(grantId: string): void {
  operatorChecks.delete(grantId);
}
