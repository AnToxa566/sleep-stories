import { ArgumentMetadata, BadRequestException, Injectable, Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { createZodValidationPipe, ZodSerializerInterceptor } from 'nestjs-zod';
import { apiErrorBody } from '../errors/api-error-body';
import { FailClosedResponseInterceptor } from './fail-closed-response.interceptor';
import { describeZodIssues } from './zod-issues';
import { ZodSerializationExceptionFilter } from './zod-serialization-exception.filter';

// Request bodies: a global pipe validates every DTO built with createZodDto from a
// contracts schema. strictSchemaDeclaration makes a @Body(), @Query() or @Param()
// typed with anything else throw ZodSchemaDeclarationException; the cost is that even
// a plain `@Param('id') id: string` needs a DTO. The client sees Nest's default 500
// body (no detail) and ZodSerializationExceptionFilter logs the HTTP method and the
// route pattern, never a value. A validation failure becomes the
// ApiErrorResponseSchema body. Only paths and issue codes reach the client, never
// the submitted values (see zod-issues.ts).
const StrictZodValidationPipe = createZodValidationPipe({
  strictSchemaDeclaration: true,
  createValidationException: (error) =>
    new BadRequestException(apiErrorBody(400, 'validation_failed', describeZodIssues(error))),
});

// Nest also runs global pipes on custom parameter decorators such as
// @CurrentUserId(). Their value comes from the server (the verified token), not
// from the client, so there is nothing to validate; without this skip the strict
// pipe would reject every such parameter as "not declared with a DTO".
@Injectable()
export class ApiZodValidationPipe extends StrictZodValidationPipe {
  override transform(value: unknown, metadata: ArgumentMetadata): unknown {
    return metadata.type === 'custom' ? value : super.transform(value, metadata);
  }
}

// Responses: a route declares `@ZodSerializerDto(SomeResponseSchema)` and the
// interceptor parses what the handler returned with it. The contracts response
// schemas are strict, so an extra key is an error rather than silently dropped. A
// mismatch is a server bug: the client sees Nest's default 500 body and the filter
// logs issue paths and codes. FailClosedResponseInterceptor covers the case the
// library leaves open: a route with no serializer and a non-empty body answers 500
// unless it is marked @UnvalidatedResponse().
@Module({
  providers: [
    { provide: APP_PIPE, useClass: ApiZodValidationPipe },
    { provide: APP_INTERCEPTOR, useClass: ZodSerializerInterceptor },
    { provide: APP_INTERCEPTOR, useClass: FailClosedResponseInterceptor },
    { provide: APP_FILTER, useClass: ZodSerializationExceptionFilter },
  ],
})
export class ValidationModule {}
