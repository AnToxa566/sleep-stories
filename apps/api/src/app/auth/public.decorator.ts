import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

// Opts a route out of the global JWT guard (deny by default). Use it only for
// routes that really are open, such as the reachability check.
//
// NEVER put it on /internal/* routes. Those are called by Cloud Tasks and Cloud
// Scheduler and must verify a Google OIDC token (SECURITY.md rule 4): use
// @InternalRoute() (internal/internal-route.decorator.ts), which applies the
// internal guard. A user JWT is not accepted there, and "public" must not be read
// as "no check".
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);
