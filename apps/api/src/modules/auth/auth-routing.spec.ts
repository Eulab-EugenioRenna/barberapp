import { hash } from "bcrypt";
import { ForbiddenException } from "@nestjs/common";
import { AuthController } from "./auth.controller";
import { PrismaService } from "../../prisma/prisma.service";
import { ConnectAuthService, AuthResponse } from "./connect-auth.service";
import { ConnectRequest } from "../../common/connect-http";

describe("SDK-owned mandatory Connect routing", () => {
  const email = "person@example.test",
    password = "Synthetic-only-Password-9!";
  const findUnique = jest.fn(),
    signIn = jest.fn(),
    signup = jest.fn();
  let controller: AuthController, user: Record<string, unknown>;
  const request: ConnectRequest = {
    headers: { origin: "http://localhost:5174" },
  };
  beforeEach(async () => {
    jest.clearAllMocks();
    user = {
      id: "u1",
      email,
      passwordHash: await hash(password, 4),
      tenantId: "t1",
      role: "owner",
      isActive: true,
      tenant: { isActive: true, isSuspended: false },
    };
    findUnique.mockResolvedValue(user);
    signIn.mockResolvedValue({
      status: "connect_redirect",
      redirectUrl: "https://provider.test/authorize",
    });
    controller = new AuthController(
      { user: { findUnique } } as unknown as PrismaService,
      { signIn, signup } as unknown as ConnectAuthService,
    );
  });
  it.each([true, false])(
    "delegates source-first routing to SDK even with no local account: %s",
    async (local) => {
      if (!local) findUnique.mockResolvedValue(null);
      expect(
        (
          (await controller.login({ email }, {} as AuthResponse, request)) as {
            status: string;
          }
        ).status,
      ).toBe("connect_redirect");
      expect(signIn).toHaveBeenCalledWith({ email }, request, {});
    },
  );
  it("never turns a legacy password into an operational local session", async () => {
    signIn.mockResolvedValue({
      status: "migration_required",
      onboarding: { challenge: "proof" },
    });
    const result = await controller.login(
      { email, password },
      {} as AuthResponse,
      request,
    );
    expect(result).toEqual({
      status: "migration_required",
      onboarding: { challenge: "proof" },
    });
  });
  it.each(["inactive", "suspended"])(
    "blocks a locally %s profile before SDK login",
    async (state) => {
      if (state === "inactive") user["isActive"] = false;
      else user["tenant"] = { isActive: true, isSuspended: true };
      await expect(
        controller.login({ email, password }, {} as AuthResponse, request),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(signIn).not.toHaveBeenCalled();
    },
  );
  it("does not reinterpret an SDK error as account absence or local access", async () => {
    signIn.mockRejectedValue(new ForbiddenException());
    await expect(
      controller.login({ email, password }, {} as AuthResponse, request),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
  it("signup delegates a request without local provisioning", async () => {
    const body = {
      email,
      password,
      firstName: "QA",
      lastName: "User",
      companyName: "Company",
    };
    signup.mockResolvedValue({ status: "migration_pending" });
    expect(await controller.signup(body, request)).toEqual({
      status: "migration_pending",
    });
    expect(signup).toHaveBeenCalledWith(body, request);
  });
});
