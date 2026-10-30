import { ApiContractError, ApiError, ApiUnavailableError } from '../../api/api-client';
import { strings } from '../../strings';
import { onboardingErrorMessage } from './onboarding-errors';

describe('onboardingErrorMessage', () => {
  it('maps an unreachable server to the connection text', () => {
    expect(onboardingErrorMessage(new ApiUnavailableError('network'))).toBe(
      strings.onboarding.errors.unavailable,
    );
    expect(onboardingErrorMessage(new ApiUnavailableError('timeout'))).toBe(
      strings.onboarding.errors.unavailable,
    );
  });

  it('maps 422 and everything else to the generic text', () => {
    const generic = strings.onboarding.errors.saveFailed;
    expect(onboardingErrorMessage(new ApiError(422, 'validation_failed'))).toBe(generic);
    expect(onboardingErrorMessage(new ApiError(500, null))).toBe(generic);
    expect(onboardingErrorMessage(new ApiContractError())).toBe(generic);
    expect(onboardingErrorMessage('boom')).toBe(generic);
  });
});
