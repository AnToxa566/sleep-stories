import { Controller, Get } from '@nestjs/common';
import { InterestsResponseSchema } from '@sleep-stories/contracts';
import type { InterestsResponse } from '@sleep-stories/contracts';
import { ZodSerializerDto } from 'nestjs-zod';
import { InterestsService } from './interests.service';

// Not @Public(): the global JWT guard applies, so only a signed-in user can read
// the catalogue. The response is parsed with InterestsResponseSchema before it leaves.
@Controller('interests')
export class InterestsController {
  constructor(private readonly interests: InterestsService) {}

  @Get()
  @ZodSerializerDto(InterestsResponseSchema)
  list(): Promise<InterestsResponse> {
    return this.interests.listActive();
  }
}
