import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { SuggestionStatusResponseSchema, TopicsResponseSchema } from '@sleep-stories/contracts';
import type { SuggestionStatusResponse, TopicsResponse } from '@sleep-stories/contracts';
import { ZodSerializerDto } from 'nestjs-zod';
import { CurrentUserId } from '../auth/current-user-id.decorator';
import { SuggestTopicsRequestDto, TopicsQueryDto } from './queue.dto';
import { TopicSuggestService } from './topic-suggest.service';
import { TopicsService } from './topics.service';

// The «Темы» list and its «Подобрать темы» sheet. The person is the verified token only; the
// query and the body hold filters and a selection, never a person.
@Controller('topics')
export class TopicsController {
  constructor(
    private readonly topics: TopicsService,
    private readonly suggester: TopicSuggestService,
  ) {}

  // A plain read: it creates no job and writes nothing.
  @Get()
  @ZodSerializerDto(TopicsResponseSchema)
  list(@CurrentUserId() userId: string, @Query() query: TopicsQueryDto): Promise<TopicsResponse> {
    return this.topics.list(userId, query);
  }

  // The person's newest topic suggestion and what is left of the cap. A plain read; the app
  // polls it while a suggestion runs.
  @Get('suggestion')
  @ZodSerializerDto(SuggestionStatusResponseSchema)
  suggestion(@CurrentUserId() userId: string): Promise<SuggestionStatusResponse> {
    return this.suggester.status(userId);
  }

  // «Подобрать темы»: one `suggest_topics` job narrowed to the ticked interests and styles.
  // Creates NO story or audio job and spends no generation (architecture rule 10); it spends
  // one of the 5 suggestions per rolling 24 hours.
  @Post('suggest')
  @HttpCode(200)
  @ZodSerializerDto(SuggestionStatusResponseSchema)
  suggest(
    @CurrentUserId() userId: string,
    @Body() body: SuggestTopicsRequestDto,
  ): Promise<SuggestionStatusResponse> {
    return this.suggester.start(userId, body);
  }
}
