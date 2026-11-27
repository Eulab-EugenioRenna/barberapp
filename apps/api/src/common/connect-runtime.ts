import {
  ForbiddenException,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { PrismaClient } from "@prisma/client";

export interface ConnectTenantConfig {
  tenantId: string;
  customerId: string;
  installationId: string;
  secret: string;
  apiUrl: string;
  issuer: string;
  clientId: string;
  callbackUrl: string;
  returnUrl: string;
  appId: string;
}
function required(name: string): string {
  const value = process.env[name];
  if (!value)
    throw new ServiceUnavailableException("Configurazione Connect incompleta");
  return value;
}
export function checkedConnectUrl(value: string): string {
  try {
    const url = new URL(value);
    const local =
      process.env["NODE_ENV"] !== "production" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (
      (url.protocol !== "https:" && !(local && url.protocol === "http:")) ||
      url.username ||
      url.password
    )
      throw new Error();
    return url.href.replace(/\/$/, "");
  } catch {
    throw new ServiceUnavailableException("URL Connect non valido");
  }
}
export function connectReturnUrl(): string {
  return checkedConnectUrl(required("ALORA_AUTH_RETURN_URL"));
}
export function connectConfig(
  tenantId: string | null,
): ConnectTenantConfig | null {
  if (!tenantId || !process.env["ALORA_CONNECT_TENANTS_JSON"]) return null;
  try {
    const all = JSON.parse(process.env["ALORA_CONNECT_TENANTS_JSON"]) as Record<
      string,
      { customerId: string; installationId: string; secret: string }
    >;
    if (!Object.hasOwn(all, tenantId)) return null;
    const tenant = all[tenantId];
    if (
      !tenant ||
      typeof tenant.customerId !== "string" ||
      !tenant.customerId ||
      typeof tenant.installationId !== "string" ||
      !tenant.installationId ||
      typeof tenant.secret !== "string" ||
      !tenant.secret
    )
      throw new Error();
    return connectConfigFromBinding(tenantId, tenant);
  } catch (error) {
    if (error instanceof ServiceUnavailableException) throw error;
    throw new ServiceUnavailableException(
      "Configurazione aziende Connect non valida",
    );
  }
}
/** Shared validation for runtime and read-only installation diagnostics. No database access. */
export function connectApplicationConfig(): Omit<
  ConnectTenantConfig,
  "tenantId" | "customerId" | "installationId" | "secret"
> {
  encryptionKey();
  const config = {
    appId: required("ALORA_CONNECT_APP_ID"),
    apiUrl: checkedConnectUrl(required("ALORA_CONNECT_API_URL")),
    issuer: process.env["ALORA_CONNECT_ISSUER"]
      ? checkedConnectUrl(required("ALORA_CONNECT_ISSUER"))
      : process.env["ALORA_CONNECT_PRESENTER_ID"]
        ? ""
        : required("ALORA_CONNECT_ISSUER"),
    clientId:
      process.env["ALORA_CONNECT_CLIENT_ID"] ||
      (process.env["ALORA_CONNECT_PRESENTER_ID"]
        ? ""
        : required("ALORA_CONNECT_CLIENT_ID")),
    callbackUrl: checkedConnectUrl(required("ALORA_CONNECT_CALLBACK_URL")),
    returnUrl: connectReturnUrl(),
  };
  if (
    !!config.issuer !== !!config.clientId ||
    !/^[a-z][a-z0-9_.:-]{0,79}$/.test(config.appId) ||
    new URL(config.callbackUrl).hash ||
    new URL(config.callbackUrl).origin !== new URL(config.returnUrl).origin
  )
    throw new ServiceUnavailableException(
      "Configurazione callback Connect non valida",
    );
  return config;
}
export function connectConfigFromBinding(
  tenantId: string,
  binding: { customerId: string; installationId: string; secret: string },
): ConnectTenantConfig {
  return { ...binding, tenantId, ...connectApplicationConfig() };
}
export async function loadConnectConfig(
  prisma: PrismaClient,
  tenantId: string | null,
) {
  const explicit = connectConfig(tenantId);
  if (explicit || !tenantId) return explicit;
  const binding = await prisma.connectTenantBinding.findUnique({
    where: { tenantId },
  });
  return binding
    ? connectConfigFromBinding(tenantId, {
        customerId: binding.customerId,
        installationId: binding.installationId,
        secret: openConnect(binding.secretCipher),
      })
    : null;
}
/**
 * Resolves the installation selected by the signed technical ticket. The
 * installation ID is never trusted as a tenant: env mappings and persisted
 * bindings remain the only source of the tenant/customer association.
 */
export async function loadConnectConfigByInstallation(
  prisma: PrismaClient,
  installationId: string,
): Promise<ConnectTenantConfig | null> {
  if (!installationId || !process.env["ALORA_CONNECT_TENANTS_JSON"])
    return loadPersistedConnectBinding(prisma, installationId);
  const all = JSON.parse(process.env["ALORA_CONNECT_TENANTS_JSON"]) as Record<
    string,
    { customerId: string; installationId: string; secret: string }
  >;
  for (const tenantId of Object.keys(all)) {
    if (all[tenantId]?.installationId !== installationId) continue;
    const config = connectConfig(tenantId);
    if (config) return config;
  }
  return loadPersistedConnectBinding(prisma, installationId);
}
async function loadPersistedConnectBinding(
  prisma: PrismaClient,
  installationId: string,
): Promise<ConnectTenantConfig | null> {
  if (!installationId) return null;
  const binding = await prisma.connectTenantBinding.findUnique({
    where: { installationId },
  });
  return binding
    ? connectConfigFromBinding(binding.tenantId, {
        customerId: binding.customerId,
        installationId: binding.installationId,
        secret: openConnect(binding.secretCipher),
      })
    : null;
}
function encryptionKey(): Buffer {
  const value = required("ALORA_CONNECT_ENCRYPTION_KEY");
  if (!/^[a-fA-F0-9]{64}$/.test(value))
    throw new ServiceUnavailableException("Chiave Connect non valida");
  return Buffer.from(value, "hex");
}
export function sealConnect(value: string): string {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  return [
    "v1",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
}
export function openConnect(value: string): string {
  try {
    const [version, iv, tag, encrypted] = value.split(".");
    if (version !== "v1" || !iv || !tag || !encrypted) throw new Error();
    const decipher = createDecipheriv(
      "aes-256-gcm",
      encryptionKey(),
      Buffer.from(iv, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(encrypted, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new ServiceUnavailableException("Credenziale Connect non leggibile");
  }
}
/**
 * Connect functions are read ONLY when a session is created (login / Connect
 * exchange) and kept in the LocalSession snapshot (see session-snapshot.ts).
 * Requests never call Connect for permissions: a function granted or withdrawn on
 * Connect takes effect at the next login. ALORA revocation stays immediate.
 */
type ConnectAccess = {
  localUserId: string | null;
  subject: string | null;
  installationId: string;
  functions: { key: string }[];
};

/** One remote call with the SDK session handle; maps a definitive denial to 401. */
export async function readConnectAccess(
  prisma: PrismaClient,
  handle: string,
): Promise<ConnectAccess> {
  const { connectApplication } = await import("./connect-application");
  const { connectHttpError } = await import("./connect-http");
  try {
    const application = await connectApplication(prisma);
    return (await application.services(handle, (server, token) =>
      server.permissions(token),
    )) as ConnectAccess;
  } catch (error) {
    // At this boundary the SDK validates the session itself and invalidates it on
    // definitive access_denied. Business permission checks run after resolution.
    if (isAccessDenied(error))
      throw new UnauthorizedException("Sessione Connect revocata o non più autorizzata");
    return connectHttpError(error);
  }
}

/** The grant must belong to exactly this local user, subject and installation. */
export function connectFunctionKeys(
  access: ConnectAccess,
  expected: { localUserId: string; subject: string | null; installationId: string | null },
): string[] {
  if (
    access.localUserId !== expected.localUserId ||
    access.subject !== expected.subject ||
    access.installationId !== expected.installationId ||
    !Array.isArray(access.functions) ||
    access.functions.some((item) => typeof item?.key !== "string")
  )
    throw new ForbiddenException("Collegamento Connect non valido");
  return access.functions.map((item) => item.key);
}

async function liveConnectSession(prisma: PrismaClient, sessionId: string, userId: string) {
  const session = await prisma.connectSession.findUnique({
    where: { id: sessionId },
  });
  if (
    !session ||
    session.userId !== userId ||
    session.revokedAt ||
    !session.sdkSessionCipher ||
    session.expiresAt <= new Date()
  )
    throw new UnauthorizedException("Ripeti l’accesso Connect");
  return session as typeof session & { sdkSessionCipher: string };
}

/**
 * Full Connect permission read for an existing Connect session. Used only for
 * sessions created before snapshots existed (once, then persisted).
 */
export async function resolveConnectPermissions(
  prisma: PrismaClient,
  sessionId: string,
  user: { id: string; tenantId: string | null; connectSubject: string | null },
): Promise<string[]> {
  const session = await liveConnectSession(prisma, sessionId, user.id);
  const access = await readConnectAccess(prisma, openConnect(session.sdkSessionCipher));
  return connectFunctionKeys(access, {
    localUserId: user.id,
    subject: user.connectSubject,
    installationId: session.installationId,
  });
}

/**
 * Token refresh keeps the Connect SSO session alive and notices a definitive
 * revocation on Connect. It is one SSO token grant and never reads permissions.
 */
export async function refreshConnectSession(
  prisma: PrismaClient,
  sessionId: string,
  user: { id: string },
): Promise<void> {
  const session = await liveConnectSession(prisma, sessionId, user.id);
  const { connectApplication } = await import("./connect-application");
  const { connectHttpError } = await import("./connect-http");
  try {
    await (await connectApplication(prisma)).auth.refresh(
      openConnect(session.sdkSessionCipher),
    );
  } catch (error) {
    if (isAccessDenied(error))
      throw new UnauthorizedException("Sessione Connect revocata o non più autorizzata");
    return connectHttpError(error);
  }
}

function isAccessDenied(error: unknown): boolean {
  return !!error && typeof error === "object" && "code" in error && error.code === "access_denied";
}
