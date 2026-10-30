import { Body, Controller, Get, Put } from '@nestjs/common';
import { MeResponseSchema } from '@sleep-stories/contracts';
import type { MeResponse } from '@sleep-stories/contracts';
import { ZodSerializerDto } from 'nestjs-zod';
import { CurrentUserId } from '../auth/current-user-id.decorator';
import { CompleteOnboardingDto } from './me.dto';
import { MeService } from './me.service';
import { OnboardingService } from './onboarding.service';

// The user is identified only by the verified token (CurrentUserId). Nothing in
// the body, query or headers can name or change the user.
// Responses are parsed with MeResponseSchema before they leave.
@Controller('me')
export class MeController {
  constructor(
    private readonly me: MeService,
    private readonly onboarding: OnboardingService,
  ) {}

  @Get()
  @ZodSerializerDto(MeResponseSchema)
  getMe(@CurrentUserId() userId: string): Promise<MeResponse> {
    return this.me.getMe(userId);
  }

  // PUT, not POST: sending the same answers again gives the same state.
  @Put('onboarding')
  @ZodSerializerDto(MeResponseSchema)
  completeOnboarding(
    @CurrentUserId() userId: string,
    @Body() body: CompleteOnboardingDto,
  ): Promise<MeResponse> {
    return this.onboarding.complete(userId, body);
  }
}
