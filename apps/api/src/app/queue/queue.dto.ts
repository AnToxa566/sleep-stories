import { QueueItemParamsSchema, ReorderQueueRequestSchema } from '@sleep-stories/contracts';
import { createZodDto } from 'nestjs-zod';

// The global validation pipe validates a @Body() or @Param() typed with these classes.
export class QueueItemParamsDto extends createZodDto(QueueItemParamsSchema) {}
export class ReorderQueueRequestDto extends createZodDto(ReorderQueueRequestSchema) {}
