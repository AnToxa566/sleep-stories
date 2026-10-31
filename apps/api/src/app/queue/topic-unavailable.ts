import { NotFoundException } from '@nestjs/common';
import { apiErrorBody } from '../errors/api-error-body';

// The one 404 for a topic a person may not queue. A topic that does not exist, someone's typed
// topic, one outside the person's styles or interests, one they heard, dismissed or rated -1,
// or one already in another item all give this same body, and it names no id, so the answer
// cannot be used to find out which topics exist (SECURITY.md rule 10).
export function topicUnavailable(): NotFoundException {
  return new NotFoundException(apiErrorBody(404, 'topic_unavailable', 'Topic is not available'));
}
