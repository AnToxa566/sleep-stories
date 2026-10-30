import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common';
import { IS_INTERNAL_KEY } from '../auth/internal-route.key';
import { InternalAuthGuard } from './internal-auth.guard';

// Marks a route (or a whole controller) as called by Cloud Tasks / Cloud Scheduler.
// One decorator does both halves, so they cannot be separated: the metadata makes
// the global JwtAuthGuard step aside, and InternalAuthGuard authenticates the
// caller. It is NOT @Public(): the route is never open.
export const InternalRoute = (): MethodDecorator & ClassDecorator =>
  applyDecorators(SetMetadata(IS_INTERNAL_KEY, true), UseGuards(InternalAuthGuard));
