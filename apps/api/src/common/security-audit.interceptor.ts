import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from "@nestjs/common";
import { concatMap } from "rxjs";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class SecurityAuditInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService) {}
  intercept(context: ExecutionContext, next: CallHandler) {
    const request = context.switchToHttp().getRequest();
    const session = request.localSession;
    if (!session || ["GET", "HEAD", "OPTIONS"].includes(request.method))
      return next.handle();
    return next.handle().pipe(
      concatMap(async (result) => {
        // Store identifiers and operation only: no request/response bodies or credentials.
        await this.prisma.auditLog.create({
          data: {
            tenantId: session.tenantId,
            actorUserId: session.user.id,
            actorRole: session.user.role,
            action: `${context.getClass().name}.${context.getHandler().name}`,
            entityType: context.getClass().name,
            entityId: request.params.id,
          },
        });
        return result;
      }),
    );
  }
}
