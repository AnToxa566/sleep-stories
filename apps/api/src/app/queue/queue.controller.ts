import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import { QueueResponseSchema } from '@sleep-stories/contracts';
import type { QueueResponse } from '@sleep-stories/contracts';
import { ZodSerializerDto } from 'nestjs-zod';
import { CurrentUserId } from '../auth/current-user-id.decorator';
import { GenerationStartService } from './generation-start.service';
import { QueueEditService } from './queue-edit.service';
import { QueueReadService } from './queue-read.service';
import { QueueItemParamsDto, ReorderQueueRequestDto } from './queue.dto';

// The person is identified only by the verified token (CurrentUserId); nothing in the
// body, query, path or headers can name another person. Every route answers with the
// whole queue, parsed with QueueResponseSchema before it leaves.
@Controller('queue')
export class QueueController {
  constructor(
    private readonly reader: QueueReadService,
    private readonly editor: QueueEditService,
    private readonly starter: GenerationStartService,
  ) {}

  @Get()
  @ZodSerializerDto(QueueResponseSchema)
  read(@CurrentUserId() userId: string): Promise<QueueResponse> {
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
}
