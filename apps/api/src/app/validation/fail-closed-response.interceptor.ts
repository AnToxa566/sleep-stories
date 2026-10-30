import {
  CallHandler,
  ExecutionContext,
  Injectable,
  InternalServerErrorException,
  Logger,
  NestInterceptor,
  StreamableFile,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, map } from 'rxjs';
import { UNVALIDATED_RESPONSE_KEY } from './unvalidated-response.decorator';

// The metadata key that nestjs-zod's @ZodSerializerDto writes (5.5.0). Not exported
// by the library, so it is repeated here; a route with a serializer would answer 500
// if this ever drifted, and the validation spec proves it has not.
export const ZOD_SERIALIZER_KEY = 'ZOD_SERIALIZER_DTO_OPTIONS';

// nestjs-zod's ZodSerializerInterceptor returns a handler's value unchanged when the
// route has no @ZodSerializerDto, so a new route could send any shape, extra fields
// included, with no error. This interceptor closes that gap (SECURITY.md rule 5): an
// HTTP route that returns a non-empty body must either declare a serializer or be
// marked @UnvalidatedResponse(); otherwise the client gets Nest's default 500 body and
// the log names the route's class and handler, never a value.
//
// Always allowed: an empty response (undefined or null) and a StreamableFile.
// Errors thrown by a handler skip this check; they go through the exception filters.
@Injectable()
export class FailClosedResponseInterceptor implements NestInterceptor {
  private readonly logger = new Logger(FailClosedResponseInterceptor.name);

  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }
    const targets = [context.getHandler(), context.getClass()];
    const hasSerializer = this.reflector.getAllAndOverride<unknown>(ZOD_SERIALIZER_KEY, targets) !== undefined;
    const isMarked = this.reflector.getAllAndOverride<boolean | undefined>(UNVALIDATED_RESPONSE_KEY, targets) === true;
    if (hasSerializer || isMarked) {
      return next.handle();
    }
    return next.handle().pipe(
      map((body) => {
        if (body === undefined || body === null || body instanceof StreamableFile) {
          return body;
        }
        this.logger.error(
          `Response has no schema: ${context.getClass().name}.${context.getHandler().name} ` +
            'returned a body without @ZodSerializerDto or @UnvalidatedResponse()',
        );
        throw new InternalServerErrorException();
      }),
    );
  }
}
