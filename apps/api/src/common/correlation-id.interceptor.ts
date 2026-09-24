import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Observable } from 'rxjs';

@Injectable()
export class CorrelationIdInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const response = context.switchToHttp().getResponse<{
      headersSent?: boolean;
      setHeader: (key: string, value: string) => void;
    }>();

    // Nest subscribes to SSE handlers after the event-stream headers are flushed.
    // Ordinary HTTP responses still receive the correlation header as before.
    if (!response.headersSent) {
      response.setHeader('x-correlation-id', randomUUID());
    }

    return next.handle();
  }
}
