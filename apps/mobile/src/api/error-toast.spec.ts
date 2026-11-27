import { strings } from '../strings';
import { ApiContractError, ApiError, ApiUnavailableError } from './http/api-client';
import { toastForError } from './error-toast';

describe('toastForError', () => {
  const text = strings.today.errors;
  it('maps the known codes', () => {
    expect(toastForError(new ApiError(429, 'generation_limit_reached'))).toBe(text.notEnoughGenerations);
    expect(toastForError(new ApiError(404, 'topic_unavailable'))).toBe(text.noOtherStory);
    expect(toastForError(new ApiError(409, 'queue_order_mismatch'))).toBe(text.queueChanged);
    expect(toastForError(new ApiError(404, 'queue_item_not_found'))).toBe(text.queueChanged);
  });
  it('uses the generic message for everything else', () => {
    expect(toastForError(new ApiError(500, null))).toBe(text.generic);
    expect(toastForError(new ApiError(400, 'validation_failed'))).toBe(text.generic);
    expect(toastForError(new ApiUnavailableError('network'))).toBe(text.generic);
    expect(toastForError(new ApiContractError())).toBe(text.generic);
    expect(toastForError('boom')).toBe(text.generic);
  });
});
