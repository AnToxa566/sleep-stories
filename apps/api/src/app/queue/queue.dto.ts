import {
  AddToQueueRequestSchema,
  QueueItemParamsSchema,
  ReorderQueueRequestSchema,
  ReplaceQueueItemRequestSchema,
  TopicsQuerySchema,
} from '@sleep-stories/contracts';
import { createZodDto } from 'nestjs-zod';

// The global validation pipe validates a @Body() or @Param() typed with these classes.
export class QueueItemParamsDto extends createZodDto(QueueItemParamsSchema) {}
export class ReorderQueueRequestDto extends createZodDto(ReorderQueueRequestSchema) {}
export class AddToQueueRequestDto extends createZodDto(AddToQueueRequestSchema) {}
export class ReplaceQueueItemRequestDto extends createZodDto(ReplaceQueueItemRequestSchema) {}
export class TopicsQueryDto extends createZodDto(TopicsQuerySchema) {}
