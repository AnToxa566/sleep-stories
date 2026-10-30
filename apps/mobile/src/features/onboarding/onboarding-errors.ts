import { ApiUnavailableError } from '../../api/api-client';
import { strings } from '../../strings';

// Russian copy for a failed PUT /me/onboarding. An unreachable server (no network, timeout,
// 502/503/504) is "could not connect"; everything else, 422 included, is the generic text.
// The error's own message is never shown.
export function onboardingErrorMessage(error: unknown): string {
  if (error instanceof ApiUnavailableError) return strings.onboarding.errors.unavailable;
  return strings.onboarding.errors.saveFailed;
}
