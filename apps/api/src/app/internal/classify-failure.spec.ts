import { GenerationError } from '../generation/generation-error';
import { LlmProviderError } from '../providers/llm/llm.provider';
import { StorageUploadError } from '../providers/storage/storage.service';
import { TtsProviderError } from '../providers/tts/tts.provider';
import { classifyFailure } from './classify-failure';

describe('classifyFailure', () => {
  it('maps an LLM error, with the status when there is one', () => {
    expect(classifyFailure(new LlmProviderError(true, 529))).toEqual({
      retryable: true,
      code: 'llm_error:529',
    });
    expect(classifyFailure(new LlmProviderError(false, 400))).toEqual({
      retryable: false,
      code: 'llm_error:400',
    });
    expect(classifyFailure(new LlmProviderError(true))).toEqual({
      retryable: true,
      code: 'llm_error',
    });
  });

  it('maps a TTS error, with the status when there is one', () => {
    expect(classifyFailure(new TtsProviderError(true, 503))).toEqual({
      retryable: true,
      code: 'tts_error:503',
    });
    expect(classifyFailure(new TtsProviderError(false))).toEqual({
      retryable: false,
      code: 'tts_error',
    });
  });

  it('treats a storage upload error as retryable', () => {
    expect(classifyFailure(new StorageUploadError())).toEqual({
      retryable: true,
      code: 'storage_error',
    });
  });

  it('maps a generation error to its code and keeps its retryable flag', () => {
    expect(classifyFailure(new GenerationError('story_truncated', true))).toEqual({
      retryable: true,
      code: 'generation:story_truncated',
    });
    expect(classifyFailure(new GenerationError('no_valid_topics', false))).toEqual({
      retryable: false,
      code: 'generation:no_valid_topics',
    });
  });

  it('treats every other error as final and unknown', () => {
    expect(classifyFailure(new Error('boom'))).toEqual({ retryable: false, code: 'unknown' });
    expect(classifyFailure('a string')).toEqual({ retryable: false, code: 'unknown' });
    expect(classifyFailure(undefined)).toEqual({ retryable: false, code: 'unknown' });
    // A look-alike is not trusted: only the known classes can be retried.
    const lookAlike = Object.assign(new Error('x'), { retryable: true, status: 500 });
    expect(classifyFailure(lookAlike)).toEqual({ retryable: false, code: 'unknown' });
  });

  it('ignores a status that is not an HTTP status number', () => {
    const odd = new LlmProviderError(true, 12345);
    expect(classifyFailure(odd).code).toBe('llm_error');
    const text = new LlmProviderError(true, 'sk-ant-FAKEKEY' as unknown as number);
    expect(classifyFailure(text).code).toBe('llm_error');
  });

  it('never puts error text into the code', () => {
    const secret = 'sk-ant-FAKEKEY-123 and the title Тайна старого маяка';
    const errors: unknown[] = [
      new Error(secret),
      Object.assign(new LlmProviderError(true, 500), { message: secret }),
      Object.assign(new TtsProviderError(true, 500), { message: secret }),
      Object.assign(new StorageUploadError(), { message: secret }),
      Object.assign(new GenerationError('story_truncated', true), { message: secret }),
    ];
    for (const error of errors) {
      const { code } = classifyFailure(error);
      expect(code).not.toContain('FAKEKEY');
      expect(code).not.toContain('маяка');
      expect(code).toMatch(/^[a-z_]+(:[a-z_0-9]+)?$/);
    }
  });
});
