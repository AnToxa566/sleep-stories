import { Controller, Get } from '@nestjs/common';
import { VoicesResponseSchema } from '@sleep-stories/contracts';
import type { VoicesResponse } from '@sleep-stories/contracts';
import { ZodSerializerDto } from 'nestjs-zod';
import { VoicesService } from './voices.service';

// Not @Public(): the global JWT guard applies, so only a signed-in user can read
// the catalogue. The response is parsed with VoicesResponseSchema before it leaves.
@Controller('voices')
export class VoicesController {
  constructor(private readonly voices: VoicesService) {}

  @Get()
  @ZodSerializerDto(VoicesResponseSchema)
  list(): Promise<VoicesResponse> {
    return this.voices.listActive();
  }
}
