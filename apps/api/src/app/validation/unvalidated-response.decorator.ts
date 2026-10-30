import { SetMetadata } from '@nestjs/common';

export const UNVALIDATED_RESPONSE_KEY = 'unvalidatedResponse';

// Opts a route out of the fail-closed response check (see
// FailClosedResponseInterceptor). Every response body must go through a contracts
// schema with @ZodSerializerDto (SECURITY.md rule 5); this marker is the only way
// to send a non-empty body without one.
//
// Allowed only for a body that carries no data at all and has no schema in
// contracts, such as the fixed greeting of the reachability check. Never use it on a
// route that returns anything read from the database, from the user or from a
// provider: give that response a contracts schema instead.
export const UnvalidatedResponse = (): MethodDecorator & ClassDecorator => SetMetadata(UNVALIDATED_RESPONSE_KEY, true);
