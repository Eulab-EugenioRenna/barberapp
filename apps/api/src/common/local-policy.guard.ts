import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import {
  RequestSession,
  resolveRequestSession,
  requireTenantId,
} from "./request-session";

import { canUseLocalFunction } from "./function-catalog";
import { operationDefinition } from "./operation-catalog";

// Unknown handlers are denied even for owners and platform administrators.
export function authorizeLocalOperation(
  session: RequestSession,
  controller: string,
  operation: string,
): void {
  const definition = operationDefinition(controller, operation);
  if (!definition) throw new ForbiddenException("Operazione non censita");
  if (definition.kind === "public") return;
  const user = session.user;
  if (!user) throw new ForbiddenException();
  if (definition.kind === "session") return;
  if (
    definition.kind === "platform" ||
    (["AuditController", "UsersController"].includes(controller) &&
      user.role === "platform_admin")
  ) {
    if (user.role === "platform_admin") return;
    throw new ForbiddenException();
  }
  requireTenantId(session);
  if (definition.kind === "tenant-context") {
    if (["owner", "manager", "reception"].includes(user.role)) return;
    throw new ForbiddenException();
  }
  // Disabled provider endpoints remain readable as disabled and mutations return 501.
  if (definition.kind === "disabled") {
    if (canUseLocalFunction(user, "settings.manage")) return;
    throw new ForbiddenException();
  }
  if (definition.kind === "function") {
    const key = user.role === "collaborator" ? definition.own : definition.key;
    if (key && canUseLocalFunction(user, key)) return;
  }
  throw new ForbiddenException("Permesso esplicito richiesto");
}

@Injectable()
export class LocalPolicyGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const controller = context.getClass().name;
    const operation = context.getHandler().name;
    if (operationDefinition(controller, operation)?.kind === "public")
      return true;
    const request = context.switchToHttp().getRequest();
    const session = await resolveRequestSession(
      this.prisma,
      request.headers.authorization,
    );
    authorizeLocalOperation(session, controller, operation);
    request.localSession = session;
    if (controller === "AppointmentsController" && request.params.id) {
      const appointment = await this.prisma.appointment.findFirst({
        where: {
          id: request.params.id,
          tenantId: requireTenantId(session),
          ...(session.user?.role === "collaborator"
            ? { collaboratorId: session.user.collaboratorId! }
            : {}),
        },
        select: { id: true },
      });
      if (!appointment)
        throw new ForbiddenException("Appuntamento non accessibile");
    }
    return true;
  }
}
