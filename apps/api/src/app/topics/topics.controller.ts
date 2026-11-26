import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { SuggestionStatusResponseSchema, TopicsResponseSchema } from '@sleep-stories/contracts';
import type { SuggestionStatusResponse, TopicsResponse } from '@sleep-stories/contracts';
import { ZodSerializerDto } from 'nestjs-zod';
import { ListensService } from '../listens/listen-report/listens.service';
import { CurrentUserId } from '../platform/auth/request/current-user-id.decorator';
import { SuggestTopicsRequestDto, TopicParamsDto, TopicsQueryDto } from './topics.dto';
import { TopicSuggestService } from './suggest-topics/topic-suggest.service';
import { TopicsService } from './topic-list/topics.service';

// The «Темы» list, its «Подобрать темы» sheet, and the removal of a topic's heard mark. The
// person is the verified token only; the path, the query and the body hold a topic, filters
// or a selection, never a person.
@Controller('topics')
export class TopicsController {
  constructor(
    private readonly topics: TopicsService,
    private readonly suggester: TopicSuggestService,
    private readonly listens: ListensService,
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

  // «Отметить как не прослушанную». 204 for every well-formed topic id, also an unknown one
  // or one only another person has listened to: nothing to delete is a success, and the
  // answer does not tell whether a topic exists. Under /topics, not /queue, because the
  // heard mark does not depend on the queue. No job (architecture rule 10).
  @Delete(':topicId/heard')
  @HttpCode(204)
  unmarkHeard(@CurrentUserId() userId: string, @Param() params: TopicParamsDto): Promise<void> {
    return this.listens.markUnheard(userId, params.topicId);
  }
}
