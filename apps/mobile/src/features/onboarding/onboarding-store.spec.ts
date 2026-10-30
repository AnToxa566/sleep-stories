import { CompleteOnboardingRequestSchema } from '@sleep-stories/contracts';
import {
  isInterestsStepValid,
  isVoiceStepValid,
  useOnboardingStore,
} from './onboarding-store';

const store = () => useOnboardingStore.getState();

beforeEach(() => store().reset());

describe('onboarding store', () => {
  it('starts with nothing selected', () => {
    expect(store().voiceSlug).toBeNull();
    expect(store().styles).toEqual([]);
    expect(store().interestSlugs).toEqual([]);
    expect(store().buildRequest()).toBeNull();
  });

  it('selects one voice at a time', () => {
    store().selectVoice('anna');
    store().selectVoice('lev');
    expect(store().voiceSlug).toBe('lev');
  });

  it('toggles styles and interests on and off', () => {
    store().toggleStyle('facts');
    store().toggleStyle('fairy_tale');
    store().toggleStyle('facts');
    expect(store().styles).toEqual(['fairy_tale']);

    store().toggleInterest('space');
    store().toggleInterest('ocean');
    store().toggleInterest('space');
    expect(store().interestSlugs).toEqual(['ocean']);
  });

  it('validates the voice step', () => {
    expect(isVoiceStepValid(store())).toBe(false);
    store().selectVoice('anna');
    expect(isVoiceStepValid(store())).toBe(true);
  });

  it('needs at least one interest AND one style on the interests step', () => {
    expect(isInterestsStepValid(store())).toBe(false);
    store().toggleInterest('space');
    expect(isInterestsStepValid(store())).toBe(false);
    store().toggleStyle('facts');
    expect(isInterestsStepValid(store())).toBe(true);
    store().toggleInterest('space');
    expect(isInterestsStepValid(store())).toBe(false);
  });

  it('builds a request that passes the contracts schema, only once complete', () => {
    store().selectVoice('mikhail');
    store().toggleInterest('history');
    expect(store().buildRequest()).toBeNull();
    store().toggleStyle('history');
    const request = store().buildRequest();
    expect(request).toEqual({
      voiceSlug: 'mikhail',
      styles: ['history'],
      interestSlugs: ['history'],
    });
    expect(CompleteOnboardingRequestSchema.safeParse(request).success).toBe(true);
  });

  it('reset clears every answer', () => {
    store().selectVoice('anna');
    store().toggleInterest('space');
    store().toggleStyle('facts');
    store().reset();
    expect(store().voiceSlug).toBeNull();
    expect(store().styles).toEqual([]);
    expect(store().interestSlugs).toEqual([]);
    expect(store().buildRequest()).toBeNull();
  });
});
