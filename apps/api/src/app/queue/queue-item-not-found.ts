import { NotFoundException } from '@nestjs/common';
import { apiErrorBody } from '../errors/api-error-body';

// The one 404 for a queue item that is not the caller's: no such id and another person's id
// give the same body, so the answer does not say which part failed.
export function queueItemNotFound(): NotFoundException {
  return new NotFoundException(apiErrorBody(404, 'queue_item_not_found', 'Queue item not found'));
}
