import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { INTERNAL_GUARD_MARKER } from '../auth/internal-route.key';
import { extractBearerToken } from '../auth/jwt-auth.guard';
import { apiErrorBody } from '../errors/api-error-body';
import {
  InternalCredentialRejectedError,
  InternalCredentialUnavailableError,
  InternalCredentialVerifier,
} from './internal-credential.verifier';

// Authenticates callers of /internal/* (SECURITY.md rule 4). Applied only through
// @InternalRoute(), which also tells the global JwtAuthGuard to step aside; a user
// JWT is never accepted here because this guard checks a different credential.
//
// Logging: only the outcome class. Never the token, a claim or an address.
@Injectable()
export class InternalAuthGuard implements CanActivate {
  // Read by the global JwtAuthGuard (auth/internal-route.key.ts): it steps aside only for
  // a route that has this guard.
  static readonly [INTERNAL_GUARD_MARKER] = true;

  private readonly logger = new Logger(InternalAuthGuard.name);

  constructor(private readonly verifier: InternalCredentialVerifier) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') {
      throw new UnauthorizedException(apiErrorBody(401, 'unauthorized', 'Unauthorized'));
    }
    const request = context.switchToHttp().getRequest<{ headers: Record<string, string | string[] | undefined> }>();
    const token = extractBearerToken(request.headers['authorization']);
    if (token === null) {
      throw new UnauthorizedException(apiErrorBody(401, 'unauthorized', 'Unauthorized'));
    }

    try {
      await this.verifier.verify(token);
      return true;
    } catch (error) {
      if (error instanceof InternalCredentialRejectedError) {
        this.logger.warn(`Internal credential rejected (${error.reason})`);
        throw new UnauthorizedException(apiErrorBody(401, 'unauthorized', 'Unauthorized'));
      }
      // Cannot decide: deny, but with 503 so that Cloud Tasks retries the job.
      const reason = error instanceof InternalCredentialUnavailableError ? error.reason : 'UnexpectedError';
      this.logger.error(`Internal authentication unavailable (${reason})`);
      throw new ServiceUnavailableException(apiErrorBody(503, 'auth_unavailable', 'Authentication is unavailable'));
    }
  }
}
