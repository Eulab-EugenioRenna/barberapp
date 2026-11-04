import { UnauthorizedException } from "@nestjs/common";
import { resolveRequestSession } from "./request-session";
import { runRequestSessionScope } from "./request-session-scope";
import { resolveConnectPermissions } from "./connect-runtime";
import type { PrismaService } from "../prisma/prisma.service";
jest.mock("./connect-runtime", () => ({
  resolveConnectPermissions: jest.fn(),
}));
const authorization = `Bearer ${"a".repeat(43)}`;
function fixture() {
  return {
    localSession: {
      findUnique: jest
        .fn()
        .mockResolvedValue({
          userId: "u1",
          connectSessionId: "s1",
          accessExpiresAt: new Date(Date.now() + 60000),
        }),
    },
    user: {
      findUnique: jest
        .fn()
        .mockResolvedValue({
          id: "u1",
          tenantId: "t1",
          role: "owner",
          isActive: true,
          tenant: { isActive: true, isSuspended: false },
          collaborator: null,
        }),
    },
  };
}
beforeEach(() => {
  jest.clearAllMocks();
  jest
    .mocked(resolveConnectPermissions)
    .mockResolvedValue(["appointments.read.all"]);
});
it("shares one current authorization between guard and controller, including concurrent callers", async () => {
  const p = fixture();
  await runRequestSessionScope(async () => {
    const read = () =>
      resolveRequestSession(p as unknown as PrismaService, authorization);
    const [guard, controller] = await Promise.all([read(), read()]);
    expect(guard).toBe(controller);
    await read();
  });
  expect(resolveConnectPermissions).toHaveBeenCalledTimes(1);
  expect(p.localSession.findUnique).toHaveBeenCalledTimes(1);
});
it("rechecks the next request and immediately rejects a revoked local session", async () => {
  const p = fixture();
  const read = () =>
    resolveRequestSession(p as unknown as PrismaService, authorization);
  await runRequestSessionScope(read);
  p.localSession.findUnique.mockResolvedValue({ revokedAt: new Date() });
  await expect(runRequestSessionScope(read)).rejects.toBeInstanceOf(
    UnauthorizedException,
  );
  expect(p.localSession.findUnique).toHaveBeenCalledTimes(2);
});
it("never shares authorization across requests or bearer tokens", async () => {
  const p = fixture();
  await Promise.all([
    runRequestSessionScope(() =>
      resolveRequestSession(p as unknown as PrismaService, authorization),
    ),
    runRequestSessionScope(() =>
      resolveRequestSession(p as unknown as PrismaService, authorization),
    ),
  ]);
  await runRequestSessionScope(async () => {
    await resolveRequestSession(p as unknown as PrismaService, authorization);
    await resolveRequestSession(
      p as unknown as PrismaService,
      `Bearer ${"b".repeat(43)}`,
    );
  });
  expect(resolveConnectPermissions).toHaveBeenCalledTimes(4);
});
it("does not cache outside an HTTP request scope", async () => {
  const p = fixture();
  await resolveRequestSession(p as unknown as PrismaService, authorization);
  await resolveRequestSession(p as unknown as PrismaService, authorization);
  expect(resolveConnectPermissions).toHaveBeenCalledTimes(2);
});

import { RequestSessionInterceptor } from "./request-session.interceptor";
import { defer, firstValueFrom, from } from "rxjs";
import type { ExecutionContext } from "@nestjs/common";
import { SSE_METADATA } from "@nestjs/common/constants";
it("reuses the actual guard result through the interceptor's asynchronous controller subscription", async () => {
  const p = fixture(),
    prisma = p as unknown as PrismaService;
  const localSession = await resolveRequestSession(prisma, authorization);
  const context = {
    getHandler: () => function handler() {},
    switchToHttp: () => ({
      getRequest: () => ({ headers: { authorization }, localSession }),
    }),
  } as unknown as ExecutionContext;
  const interceptor = new RequestSessionInterceptor(prisma);
  const result = await firstValueFrom(
    interceptor.intercept(context, {
      handle: () =>
        defer(() => from(resolveRequestSession(prisma, authorization))),
    }),
  );
  expect(result).toBe(localSession);
  expect(resolveConnectPermissions).toHaveBeenCalledTimes(1);
});
it("leaves stream subscriptions uncached so each tick revalidates current access", async () => {
  const p = fixture(),
    prisma = p as unknown as PrismaService;
  const localSession = await resolveRequestSession(prisma, authorization);
  const handler = () => undefined;
  Reflect.defineMetadata(SSE_METADATA, true, handler);
  const context = {
    getHandler: () => handler,
    switchToHttp: () => ({
      getRequest: () => ({ headers: { authorization }, localSession }),
    }),
  } as unknown as ExecutionContext;
  const stream = new RequestSessionInterceptor(prisma).intercept(context, {
    handle: () =>
      defer(() => from(resolveRequestSession(prisma, authorization))),
  });
  await firstValueFrom(stream);
  await firstValueFrom(stream);
  expect(resolveConnectPermissions).toHaveBeenCalledTimes(3);
});
