import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ListenReportResponseSchema } from '@sleep-stories/contracts';
import type { ListenReportResponse } from '@sleep-stories/contracts';
import { ZodSerializerDto } from 'nestjs-zod';
import { CurrentUserId } from '../auth/current-user-id.decorator';
import { ListenReportRequestDto } from './listens.dto';
import { ListensService } from './listens.service';

// The person is identified only by the verified token (CurrentUserId); the voice comes from
// their preferences. The body names only the story. 200, not 201: the report may record
// nothing (`recorded: false`).
@Controller('listens')
export class ListensController {
  constructor(private readonly listens: ListensService) {}

  @Post()
  @HttpCode(200)
  @ZodSerializerDto(ListenReportResponseSchema)
  report(
    @CurrentUserId() userId: string,
    @Body() body: ListenReportRequestDto,
  ): Promise<ListenReportResponse> {
    return this.listens.report(userId, body);
  }
}
