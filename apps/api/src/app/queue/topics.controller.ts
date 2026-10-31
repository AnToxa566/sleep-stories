import { Controller, Get, Query } from '@nestjs/common';
import { TopicsResponseSchema } from '@sleep-stories/contracts';
import type { TopicsResponse } from '@sleep-stories/contracts';
import { ZodSerializerDto } from 'nestjs-zod';
import { CurrentUserId } from '../auth/current-user-id.decorator';
import { TopicsQueryDto } from './queue.dto';
import { TopicsService } from './topics.service';

// The «Темы» list. The person is the verified token only; the query holds filters, never a
// person. A plain read: it creates no job and writes nothing.
@Controller('topics')
export class TopicsController {
  constructor(private readonly topics: TopicsService) {}

  @Get()
  @ZodSerializerDto(TopicsResponseSchema)
  list(@CurrentUserId() userId: string, @Query() query: TopicsQueryDto): Promise<TopicsResponse> {
    return this.topics.list(userId, query);
  }
}
