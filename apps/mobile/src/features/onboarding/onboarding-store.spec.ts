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
      customInterests: [],
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

  describe('custom interests', () => {
    it('adds a trimmed, lowercased topic and reports it', () => {
      expect(store().addCustomInterest('  Дирижабли  ')).toBe(true);
      expect(store().customInterests).toEqual(['дирижабли']);
    });

    it('ignores a duplicate in a different case', () => {
      store().addCustomInterest('Дирижабли');
      expect(store().addCustomInterest('дирижАБЛИ ')).toBe(false);
      expect(store().customInterests).toEqual(['дирижабли']);
    });

    it('ignores blank and invalid text', () => {
      expect(store().addCustomInterest('')).toBe(false);
      expect(store().addCustomInterest('   ')).toBe(false);
      expect(store().addCustomInterest('a\nb')).toBe(false);
      expect(store().addCustomInterest('я'.repeat(61))).toBe(false);
      expect(store().customInterests).toEqual([]);
    });

    it('stops at 20 topics', () => {
      for (let i = 0; i < 20; i += 1) expect(store().addCustomInterest(`тема ${i}`)).toBe(true);
      expect(store().addCustomInterest('лишняя')).toBe(false);
      expect(store().customInterests).toHaveLength(20);
    });

    it('removes a topic', () => {
      store().addCustomInterest('одна');
      store().addCustomInterest('другая');
      store().removeCustomInterest('одна');
      expect(store().customInterests).toEqual(['другая']);
    });

    it('goes into the request, and custom topics alone satisfy the interests step', () => {
      store().selectVoice('anna');
      store().toggleStyle('facts');
      store().addCustomInterest('Дирижабли');
      expect(isInterestsStepValid(store())).toBe(true);
      const request = store().buildRequest();
      expect(request).toEqual({
        voiceSlug: 'anna',
        styles: ['facts'],
        interestSlugs: [],
        customInterests: ['дирижабли'],
      });
    });

    it('reset clears them', () => {
      store().addCustomInterest('одна');
      store().reset();
      expect(store().customInterests).toEqual([]);
    });
  });
});
