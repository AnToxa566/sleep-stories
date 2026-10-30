import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { Public } from './auth/public.decorator';
import { UnvalidatedResponse } from './validation/unvalidated-response.decorator';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  // Reachability check, also used from a phone on the LAN during development. It
  // returns a fixed greeting and no data, and contracts has no schema for it, so it
  // is the one route that opts out of response validation.
  @Public()
  @UnvalidatedResponse()
  @Get()
  getData() {
    return this.appService.getData();
  }
}
