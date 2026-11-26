import { strings } from '../strings';
import { ApiError } from './api-client';

// The message for the toast after a failed request. Any code the screen does not know is
// the generic one. Fixed Russian copy only; nothing from the error goes to the person.
export function toastForError(error: unknown): string {
  const text = strings.today.errors;
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'generation_limit_reached':
        return text.notEnoughGenerations;
      case 'topic_unavailable':
        return text.noOtherStory;
      case 'queue_order_mismatch':
      case 'queue_item_not_found':
        return text.queueChanged;
      default:
        return text.generic;
    }
  }
  return text.generic;
}
