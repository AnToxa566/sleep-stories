import { ArgumentsHost, Catch, Logger } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { ZodSchemaDeclarationException, ZodSerializationException } from 'nestjs-zod';
import { describeZodIssues } from './zod-issues';

// Nest does not log an HttpException, and both of these are server bugs that would
// otherwise be invisible: the client only sees Nest's default 500 body.
//
// - ZodSerializationException: a response did not match its contracts schema. The log
//   line carries issue paths and codes only, never values.
// - ZodSchemaDeclarationException: a handler parameter is typed with something other
//   than a contracts DTO. The pipe that throws it has no access to the handler, so the
//   log line names the HTTP method and the route pattern (for example
//   `PUT /api/me/:id`), which is declared in code and carries no request value. The
//   handler's own name is not available at this point.
@Catch(ZodSerializationException, ZodSchemaDeclarationException)
export class ZodSerializationExceptionFilter extends BaseExceptionFilter {
  private readonly logger = new Logger(ZodSerializationExceptionFilter.name);

  override catch(exception: ZodSerializationException | ZodSchemaDeclarationException, host: ArgumentsHost): void {
    if (exception instanceof ZodSchemaDeclarationException) {
      this.logger.error(`A handler parameter is not declared with a contracts DTO (${describeRoute(host)})`);
    } else {
      this.logger.error(`Response did not match its schema. ${describeZodIssues(exception.getZodError())}`);
    }
    super.catch(exception, host);
  }
}

// "<METHOD> <route pattern>", or a placeholder when the request is not an Express one.
function describeRoute(host: ArgumentsHost): string {
  if (host.getType() !== 'http') {
    return 'not an HTTP request';
  }
  const request = host.switchToHttp().getRequest<{ method?: unknown; route?: { path?: unknown } }>();
  const method = typeof request.method === 'string' ? request.method : 'unknown method';
  const path = request.route?.path;
  return `${method} ${typeof path === 'string' ? path : 'unknown route'}`;
}
