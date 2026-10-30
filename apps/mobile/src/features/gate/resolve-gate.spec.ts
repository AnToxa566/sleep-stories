import { ApiError, ApiUnavailableError } from '../../api/api-client';
import { resolveGate, toMeState, type MeState } from './resolve-gate';

const loading: MeState = { kind: 'loading' };
const notOnboarded: MeState = { kind: 'ready', onboardingCompleted: false };
const onboarded: MeState = { kind: 'ready', onboardingCompleted: true };
const failed: MeState = { kind: 'failed', unauthorized: false };
const unauthorized: MeState = { kind: 'failed', unauthorized: true };

describe('resolveGate', () => {
  it.each([loading, notOnboarded, onboarded, failed, unauthorized])(
    'shows the splash while the session is restoring, whatever /me says (%j)',
    (me) => {
      expect(resolveGate('restoring', me)).toBe('splash');
    },
  );

  it.each([loading, notOnboarded, onboarded, failed, unauthorized])(
    'shows auth when signed out, whatever /me says (%j)',
    (me) => {
      expect(resolveGate('signedOut', me)).toBe('auth');
    },
  );

  it('keeps the splash while /me loads for a signed-in user', () => {
    expect(resolveGate('signedIn', loading)).toBe('splash');
  });

  it('sends a signed-in user without onboarding to onboarding', () => {
    expect(resolveGate('signedIn', notOnboarded)).toBe('onboarding');
  });

  it('sends an onboarded user home', () => {
    expect(resolveGate('signedIn', onboarded)).toBe('home');
  });

  it('shows the error screen when /me fails for a reason other than 401', () => {
    expect(resolveGate('signedIn', failed)).toBe('error');
  });

  it('stays on the splash on a 401 until the sign-out completes', () => {
    expect(resolveGate('signedIn', unauthorized)).toBe('splash');
  });
});

describe('toMeState', () => {
  it('is loading while pending', () => {
    expect(toMeState({ status: 'pending', data: undefined, error: null })).toEqual(loading);
  });

  it('maps success data to ready', () => {
    expect(
      toMeState({ status: 'success', data: { onboardingCompleted: false, preferences: null }, error: null }),
    ).toEqual(notOnboarded);
    expect(
      toMeState({
        status: 'success',
        data: {
          onboardingCompleted: true,
          preferences: { voiceSlug: 'anna', styles: ['facts'], interestSlugs: ['space'] },
        },
        error: null,
      }),
    ).toEqual(onboarded);
  });

  it('marks a 401 as unauthorized and anything else as a plain failure', () => {
    expect(toMeState({ status: 'error', data: undefined, error: new ApiError(401, 'unauthorized') })).toEqual(
      unauthorized,
    );
    expect(toMeState({ status: 'error', data: undefined, error: new ApiUnavailableError('server') })).toEqual(failed);
    expect(toMeState({ status: 'error', data: undefined, error: new ApiError(500, null) })).toEqual(failed);
    expect(toMeState({ status: 'error', data: undefined, error: new Error('boom') })).toEqual(failed);
  });

  it('keeps existing data when a refetch fails', () => {
    expect(
      toMeState({
        status: 'error',
        data: { onboardingCompleted: true, preferences: { voiceSlug: 'anna', styles: ['facts'], interestSlugs: ['space'] } },
        error: new ApiUnavailableError('network'),
      }),
    ).toEqual(onboarded);
  });
});
