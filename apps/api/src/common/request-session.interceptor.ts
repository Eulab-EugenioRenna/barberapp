import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from "@nestjs/common";
import { SSE_METADATA } from "@nestjs/common/constants";
import { Observable } from "rxjs";
import { PrismaService } from "../prisma/prisma.service";
import type { RequestSession } from "./request-session";
import { runRequestSessionScope } from "./request-session-scope";

/** Reuse the guard's authorization only for this HTTP request, never across requests. */
@Injectable()
export class RequestSessionInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService) {}
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    // Each event-stream tick must continue to recheck revocations and current permissions.
    if (Reflect.getMetadata(SSE_METADATA, context.getHandler()))
      return next.handle();
    const request = context
      .switchToHttp()
      .getRequest<{
        headers: { authorization?: string };
        localSession?: RequestSession;
      }>();
    return new Observable((subscriber) =>
      runRequestSessionScope(
        () => {
          const subscription = next.handle().subscribe(subscriber);
          return () => subscription.unsubscribe();
        },
        request.localSession
          ? {
              prisma: this.prisma,
              authorization: request.headers.authorization,
              session: request.localSession,
            }
          : undefined,
      ),
    );
  }
}
