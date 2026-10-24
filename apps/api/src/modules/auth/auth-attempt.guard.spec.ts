import {
  ExecutionContext,
  HttpException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { AppCacheService } from "../../cache/cache.service";
import { AuthAttemptGuard } from "./auth-attempt.guard";
const context = () =>
  ({
    getClass: () => ({ name: "AuthController" }),
    getHandler: () => ({ name: "login" }),
    switchToHttp: () => ({
      getRequest: () => ({
        ip: "127.0.0.1",
        body: { email: "User@example.test" },
        headers: { "x-forwarded-for": "untrusted" },
      }),
    }),
  }) as unknown as ExecutionContext;
describe("auth attempt limits", () => {
  it("rejects a high request count without trusting a forwarded IP", async () => {
    const increment = jest.fn().mockResolvedValue(121);
    await expect(
      new AuthAttemptGuard({
        increment,
      } as unknown as AppCacheService).canActivate(context()),
    ).rejects.toBeInstanceOf(HttpException);
    expect(JSON.stringify(increment.mock.calls)).not.toContain("untrusted");
    expect(JSON.stringify(increment.mock.calls)).not.toContain(
      "User@example.test",
    );
  });
  it("fails closed if the shared limiter is unavailable", async () => {
    const increment = jest
      .fn()
      .mockRejectedValue(new Error("redis unavailable"));
    await expect(
      new AuthAttemptGuard({
        increment,
      } as unknown as AppCacheService).canActivate(context()),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
