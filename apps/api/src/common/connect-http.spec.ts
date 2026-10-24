import {
  ForbiddenException,
  UnauthorizedException,
  ServiceUnavailableException,
  BadRequestException,
} from "@nestjs/common";
import {
  connectBrowser,
  applyConnectCookies,
  connectHttpError,
} from "./connect-http";
import { AuthResponse } from "./connect-http";
describe("Connect HTTP adapter", () => {
  const before = { ...process.env };
  beforeEach(() =>
    Object.assign(process.env, {
      NODE_ENV: "test",
      ALORA_CONNECT_APP_ID: "alora",
      ALORA_CONNECT_API_URL: "http://localhost:8088",
      ALORA_CONNECT_ISSUER: "http://localhost:8080/realms/eulab",
      ALORA_CONNECT_CLIENT_ID: "qa",
      ALORA_CONNECT_CALLBACK_URL: "http://localhost:5174/auth/connect/callback",
      ALORA_AUTH_RETURN_URL: "http://localhost:5174/admin/#/login",
      ALORA_CONNECT_ENCRYPTION_KEY: "a".repeat(64),
    }),
  );
  afterEach(() => {
    process.env = { ...before };
  });
  it("uses actual POST Origin and refuses absent/foreign origins", () => {
    expect(
      connectBrowser({
        headers: {
          origin: "http://localhost:5174",
          cookie: "connect_x_flow=opaque; other=ignored",
        },
      }),
    ).toEqual({
      origin: "http://localhost:5174",
      cookies: { connect_x_flow: "opaque" },
    });
    for (const origin of [undefined, "https://foreign.test"])
      expect(() => connectBrowser({ headers: { origin } })).toThrow(
        ForbiddenException,
      );
  });
  it("requires the exact configured callback Host including port", () => {
    expect(
      connectBrowser({ headers: { host: "localhost:5174" } }, true).origin,
    ).toBe("http://localhost:5174");
    expect(() =>
      connectBrowser({ headers: { host: "localhost" } }, true),
    ).toThrow(ForbiddenException);
  });
  it("rejects ambiguous SDK cookies", () => {
    expect(() =>
      connectBrowser({
        headers: {
          origin: "http://localhost:5174",
          cookie: "connect_x_flow=a; connect_x_flow=b",
        },
      }),
    ).toThrow(UnauthorizedException);
  });
  it("translates SDK cookie seconds to Express milliseconds without dropping flags", () => {
    const cookie = jest.fn();
    applyConnectCookies({ cookie } as unknown as AuthResponse, [
      {
        name: "__Host-connect_x_flow",
        value: "opaque",
        maxAge: 120,
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/",
      },
    ]);
    expect(cookie).toHaveBeenCalledWith("__Host-connect_x_flow", "opaque", {
      maxAge: 120000,
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
    });
  });
  it("redacts remote errors and keeps typed recovery failures actionable", () => {
    expect(() => connectHttpError(new Error("provider secret"))).toThrow(
      ServiceUnavailableException,
    );
    expect(() =>
      connectHttpError({
        code: "invalid_password",
        message: "provider secret",
      }),
    ).toThrow(BadRequestException);
    expect(() => connectHttpError({ code: "access_denied" })).toThrow(
      ForbiddenException,
    );
  });
});
