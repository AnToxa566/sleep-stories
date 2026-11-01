import { NotFoundException } from '@nestjs/common';
import { apiErrorBody } from '../errors/api-error-body';

// The one 404 for a listen report that cannot be accepted: an unknown story id, a story with
// no audio in the person's voice, and a person with no preferences all give the same body, so
// the answer does not say which part failed. `topic_unavailable` is the closest existing code
// in the contracts; a dedicated code would be a contracts change.
export function storyUnavailable(): NotFoundException {
  return new NotFoundException(apiErrorBody(404, 'topic_unavailable', 'Story not available'));
}
