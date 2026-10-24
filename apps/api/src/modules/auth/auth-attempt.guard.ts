import {
  CanActivate,
  ExecutionContext,
  HttpException,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import { AppCacheService } from "../../cache/cache.service";

@Injectable()
export class AuthAttemptGuard implements CanActivate {
  constructor(private readonly cache: AppCacheService) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const route = context.getClass().name + "." + context.getHandler().name;
    if (
      ![
        "AuthController.login",
        "AuthController.signup",
        "ConnectAuthController.accept",
      ].includes(route)
    )
      return true;
    const request = context.switchToHttp().getRequest();
    // Express' socket address only: an arbitrary X-Forwarded-For must not bypass this limit.
    const digest = (value: string) =>
      createHash("sha256").update(value).digest("hex");
    const email = request.body?.email;
    let ipCount: number,
      accountCount = 0;
    try {
      ipCount = await this.cache.increment(
        "auth:attempt:ip:" +
          route +
          ":" +
          digest(request.ip ?? request.socket?.remoteAddress ?? "unknown"),
        60,
      );
      if (typeof email === "string")
        accountCount = await this.cache.increment(
          "auth:attempt:account:" + digest(email.trim().toLowerCase()),
          300,
        );
    } catch {
      throw new ServiceUnavailableException(
        "Verifica di accesso temporaneamente non disponibile",
      );
    }
    if (ipCount > 120 || accountCount > 20)
      throw new HttpException(
        "Troppi tentativi. Attendi prima di riprovare.",
        429,
      );
    return true;
  }
}
