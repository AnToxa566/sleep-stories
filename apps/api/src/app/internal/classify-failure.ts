import { GenerationError } from '../generation/generation-error';
import { LlmProviderError } from '../providers/llm/llm.provider';
import { StorageUploadError } from '../providers/storage/storage.service';
import { TtsProviderError } from '../providers/tts/tts.provider';

export interface FailureClass {
  // Whether another attempt can help. Only an error that says so is retried: an unknown
  // error type is final, because a retry could pay for the same provider call again.
  retryable: boolean;
  // Stored in generation_jobs.last_error. A fixed vocabulary: `llm_error[:status]`,
  // `tts_error[:status]`, `storage_error`, `generation:<code>`, `unknown`. Never the text
  // of an error (SECURITY.md rule 9): messages are not read here at all.
  code: string;
}

const withStatus = (base: string, status: unknown): string =>
  typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599
    ? `${base}:${status}`
    : base;

export function classifyFailure(error: unknown): FailureClass {
  if (error instanceof LlmProviderError) {
    return { retryable: error.retryable === true, code: withStatus('llm_error', error.status) };
  }
  if (error instanceof TtsProviderError) {
    return { retryable: error.retryable === true, code: withStatus('tts_error', error.status) };
  }
  if (error instanceof StorageUploadError) {
    // StorageUploadError carries no flag. An upload fails for transient reasons (network,
    // service) far more often than for permanent ones, and a retry of a failed upload is
    // cheap, so it counts as retryable; the attempts limit still ends it.
    return { retryable: true, code: 'storage_error' };
  }
  if (error instanceof GenerationError) {
    return { retryable: error.retryable === true, code: `generation:${error.code}` };
  }
  return { retryable: false, code: 'unknown' };
}
