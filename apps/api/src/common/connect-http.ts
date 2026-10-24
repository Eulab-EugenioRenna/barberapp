import {
  BadRequestException,
  ForbiddenException,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import type {
  BrowserContext,
  CookieDirective,
} from "@eulab/connect/application";
import { connectApplicationConfig } from "./connect-runtime";

export interface ConnectRequest {
  headers: {
    origin?: string;
    cookie?: string;
    host?: string;
    authorization?: string;
  };
}
export interface AuthResponse {
  cookie(
    name: string,
    value: string,
    options: Record<string, unknown>,
  ): unknown;
  clearCookie(name: string, options: Record<string, unknown>): unknown;
  redirect(status: number, url: string): unknown;
  setHeader(name: string, value: string): unknown;
}
/** No Origin/Host fallback from Forwarded headers. The ingress must preserve the public Host. */
export function connectBrowser(
  request: ConnectRequest,
  callback = false,
): BrowserContext {
  const expected = new URL(connectApplicationConfig().callbackUrl);
  const origin = callback
    ? request.headers.host === expected.host
      ? expected.origin
      : ""
    : request.headers.origin;
  if (origin !== expected.origin)
    throw new ForbiddenException("Origine della richiesta non valida");
  const cookies: Record<string, string> = {};
  for (const part of (request.headers.cookie ?? "").split(";")) {
    const at = part.indexOf("=");
    if (at < 0) continue;
    const name = part.slice(0, at).trim(),
      value = part.slice(at + 1).trim();
    if (!/^(?:__Host-)?connect_/.test(name)) continue;
    if (Object.hasOwn(cookies, name))
      throw new UnauthorizedException("Ripeti l’accesso Connect");
    cookies[name] = value;
  }
  return { origin: origin!, cookies };
}
export function applyConnectCookies(
  response: AuthResponse,
  cookies: CookieDirective[],
): void {
  for (const { name, value, maxAge, ...options } of cookies)
    response.cookie(name, value, { ...options, maxAge: maxAge * 1000 });
}
export function connectHttpError(error: unknown): never {
  const code =
    error && typeof error === "object" && "code" in error
      ? error.code
      : undefined;
  if (code === "invalid_credentials")
    throw new UnauthorizedException("Email o password non corretti");
  if (code === "invalid_consent")
    throw new BadRequestException("Conferma nuovamente il consenso");
  if (code === "invalid_password")
    throw new BadRequestException(
      "Scegli una nuova password Connect diversa da quella locale",
    );
  if (code === "access_denied" || code === "provision_conflict")
    throw new ForbiddenException(
      "Accesso o collegamento Connect da verificare con EULAB",
    );
  if (
    ["invalid_flow", "invalid_context", "session_expired"].includes(
      String(code),
    )
  )
    throw new UnauthorizedException("Ripeti l’accesso Connect");
  // Already-redacted local HTTP errors contain no provider/database details.
  if (
    error instanceof ForbiddenException ||
    error instanceof UnauthorizedException ||
    error instanceof BadRequestException ||
    error instanceof ServiceUnavailableException
  )
    throw error;
  throw new ServiceUnavailableException(
    "Connect non disponibile o non configurato. Riprova dopo la verifica EULAB",
  );
}
