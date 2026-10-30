import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { apiErrorBody } from '../errors/api-error-body';
import { AccessTokenVerifier, AuthUnavailableError, TokenRejectedError } from './access-token-verifier';
import type { AuthenticatedRequest } from './authenticated-request';
import { IS_INTERNAL_KEY, isInternalGuard } from './internal-route.key';
import { IS_PUBLIC_KEY } from './public.decorator';

// Exactly `Authorization: Bearer <token>`: one space, a single token with no
// whitespace. The scheme is case-insensitive (RFC 9110); nothing else is accepted.
const BEARER = /^Bearer ([^\s]+)$/i;
// A real Supabase access token is well under 2 KB. A cap stops a huge header from
// reaching the parser.
const MAX_TOKEN_LENGTH = 8192;

// Registered as APP_GUARD: every route requires a valid access token unless it is
// marked @Public(). Deny by default means a new route is protected before anyone
// remembers to protect it.
//
// Logging: only the outcome class (jose error class name and code). Never the
// token, its claims, the user id or an email (SECURITY.md rule 9).
@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly logger = new Logger(JwtAuthGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly verifier: AccessTokenVerifier,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic === true) {
      return true;
    }
    // An internal route is authenticated by InternalAuthGuard, not by a user token. The
    // user guard steps aside only when BOTH are present on the route (handler or class):
    // the IS_INTERNAL_KEY mark and the internal guard itself. A route with the mark but
    // without the guard is therefore still authenticated here as a user route (401 for a
    // bad token), never left open. @InternalRoute() applies both; a test also fails for
    // any route under `internal` without the mark, and for a mark without the guard.
    // This is not the public check: a user id is never set here.
    const targets = [context.getHandler(), context.getClass()];
    const isInternal = this.reflector.getAllAndOverride<boolean | undefined>(IS_INTERNAL_KEY, targets);
    if (isInternal === true) {
      const guards = this.reflector.getAllAndMerge<unknown[]>(GUARDS_METADATA, targets);
      if (guards.some(isInternalGuard)) {
        return true;
      }
    }
    if (context.getType() !== 'http') {
      throw new UnauthorizedException(apiErrorBody(401, 'unauthorized', 'Unauthorized'));
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = extractBearerToken(request.headers['authorization']);
    if (token === null) {
      throw new UnauthorizedException(apiErrorBody(401, 'unauthorized', 'Unauthorized'));
    }

    try {
      const { userId } = await this.verifier.verify(token);
      request.auth = { userId };
      return true;
    } catch (error) {
      if (error instanceof TokenRejectedError) {
        this.logger.warn(`Access token rejected (${error.reason})`);
        throw new UnauthorizedException(apiErrorBody(401, 'unauthorized', 'Unauthorized'));
      }
      // Anything that is not a clear "the token is bad" is "cannot decide". Deny,
      // but with 503 so that the app keeps the session.
      const reason = error instanceof AuthUnavailableError ? error.reason : 'UnexpectedError';
      this.logger.error(`Authentication unavailable (${reason})`);
      throw new ServiceUnavailableException(apiErrorBody(503, 'auth_unavailable', 'Authentication is unavailable'));
    }
  }
}

// Shared with InternalAuthGuard: one strict parser for both Authorization headers.
export function extractBearerToken(header: string | string[] | undefined): string | null {
  if (typeof header !== 'string') {
    return null;
  }
  const match = BEARER.exec(header);
  if (match === null || match[1].length > MAX_TOKEN_LENGTH) {
    return null;
  }
  return match[1];
}
