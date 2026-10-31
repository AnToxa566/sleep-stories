import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import { QueueResponseSchema } from '@sleep-stories/contracts';
import type { QueueResponse } from '@sleep-stories/contracts';
import { ZodSerializerDto } from 'nestjs-zod';
import { CurrentUserId } from '../auth/current-user-id.decorator';
import { GenerationStartService } from './generation-start.service';
import { QueueEditService } from './queue-edit.service';
import { QueueReadService } from './queue-read.service';
import { QueuePickService } from './queue-pick.service';
import { QueueTopUpService } from './queue-top-up.service';
import {
  AddToQueueRequestDto,
  QueueItemParamsDto,
  ReorderQueueRequestDto,
  ReplaceQueueItemRequestDto,
} from './queue.dto';

// The person is identified only by the verified token (CurrentUserId); nothing in the
// body, query, path or headers can name another person. Every route answers with the
// whole queue, parsed with QueueResponseSchema before it leaves.
@Controller('queue')
export class QueueController {
  constructor(
    private readonly reader: QueueReadService,
    private readonly editor: QueueEditService,
    private readonly starter: GenerationStartService,
    private readonly picker: QueuePickService,
    private readonly topUp: QueueTopUpService,
  ) {}

  @Get()
  @ZodSerializerDto(QueueResponseSchema)
  read(@CurrentUserId() userId: string): Promise<QueueResponse> {
    return this.reader.read(userId);
  }

  // «Собрать темы» on an empty queue: fills it from the pool and, when the pool is not
  // enough, asks for new topic suggestions (at most 3 per rolling 24 hours). Creates NO story
  // or audio job and spends no generation (architecture rule 10). When the suggestion cap is
  // used up the answer is still 200, with an empty queue and `collecting: false`. No body:
  // the person is the token.
  @Post('collect')
  @HttpCode(200)
  @ZodSerializerDto(QueueResponseSchema)
  async collect(@CurrentUserId() userId: string): Promise<QueueResponse> {
    await this.topUp.run(userId);
    return this.reader.read(userId);
  }

  @Delete('items/:itemId')
  @ZodSerializerDto(QueueResponseSchema)
  remove(
    @CurrentUserId() userId: string,
    @Param() params: QueueItemParamsDto,
  ): Promise<QueueResponse> {
    return this.editor.remove(userId, params.itemId);
  }

  // PUT, not POST: sending the same order again gives the same state.
  @Put('order')
  @ZodSerializerDto(QueueResponseSchema)
  reorder(
    @CurrentUserId() userId: string,
    @Body() body: ReorderQueueRequestDto,
  ): Promise<QueueResponse> {
    return this.editor.reorder(userId, body.itemIds);
  }

  // The main button: starts every item that is not ready and not being made, or none at all
  // (429 when fewer generations are left than items). POST because it spends the allowance;
  // 200, not 201, because no resource is created for the caller. No body: the person is the
  // token, the items are the queue.
  @Post('generate')
  @HttpCode(200)
  @ZodSerializerDto(QueueResponseSchema)
  generate(@CurrentUserId() userId: string): Promise<QueueResponse> {
    return this.starter.start(userId);
  }

  // «Создать сейчас» and «Повторить» on one item. Starting an item that is ready or being
  // made is a 200 that changes nothing.
  @Post('items/:itemId/generate')
  @HttpCode(200)
  @ZodSerializerDto(QueueResponseSchema)
  generateItem(
    @CurrentUserId() userId: string,
    @Param() params: QueueItemParamsDto,
  ): Promise<QueueResponse> {
    return this.starter.start(userId, params.itemId);
  }

  // Adds topics from «Темы» to the end of the queue. Never starts a generation. A topic the
  // person may not queue is a 404 for the whole request; one already queued is skipped.
  @Post('items')
  @HttpCode(200)
  @ZodSerializerDto(QueueResponseSchema)
  add(
    @CurrentUserId() userId: string,
    @Body() body: AddToQueueRequestDto,
  ): Promise<QueueResponse> {
    return this.picker.add(userId, body.topicIds);
  }

  // Replaces the topic of one item (the picker). The item keeps its place. Never generates.
  @Post('items/:itemId/replace')
  @HttpCode(200)
  @ZodSerializerDto(QueueResponseSchema)
  replace(
    @CurrentUserId() userId: string,
    @Param() params: QueueItemParamsDto,
    @Body() body: ReplaceQueueItemRequestDto,
  ): Promise<QueueResponse> {
    return this.picker.replace(userId, params.itemId, body.topicId);
  }

  // «Другая история»: the server chooses another topic of the same style. No body.
  @Post('items/:itemId/another')
  @HttpCode(200)
  @ZodSerializerDto(QueueResponseSchema)
  another(
    @CurrentUserId() userId: string,
    @Param() params: QueueItemParamsDto,
  ): Promise<QueueResponse> {
    return this.picker.another(userId, params.itemId);
  }
}
