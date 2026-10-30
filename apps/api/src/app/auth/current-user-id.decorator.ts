import { createParamDecorator, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import type { AuthenticatedRequest } from './authenticated-request';
import { apiErrorBody } from '../errors/api-error-body';

// The id of the user whose token JwtAuthGuard verified. It is the only way a
// handler learns who is calling. If a handler asks for it on a route that the
// guard did not authenticate (a @Public() route), that is a programming error and
// fails closed with 401 instead of returning undefined.
export const CurrentUserId = createParamDecorator((_data: unknown, context: ExecutionContext): string => {
  const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
  if (request.auth === undefined) {
    throw new UnauthorizedException(apiErrorBody(401, 'unauthorized', 'Unauthorized'));
  }
  return request.auth.userId;
});
