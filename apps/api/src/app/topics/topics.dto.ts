import {
  SuggestTopicsRequestSchema,
  TopicParamsSchema,
  TopicsQuerySchema,
} from '@sleep-stories/contracts';
import { createZodDto } from 'nestjs-zod';

// The global validation pipe validates a @Query(), @Body() or @Param() typed with these classes.
export class TopicsQueryDto extends createZodDto(TopicsQuerySchema) {}
export class TopicParamsDto extends createZodDto(TopicParamsSchema) {}
export class SuggestTopicsRequestDto extends createZodDto(SuggestTopicsRequestSchema) {}
