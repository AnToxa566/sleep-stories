import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Put,
  ServiceUnavailableException,
} from '@nestjs/common';
import { MeResponseSchema } from '@sleep-stories/contracts';
import type { MeResponse } from '@sleep-stories/contracts';
import { ZodSerializerDto } from 'nestjs-zod';
import { AuthAdminError } from '../../providers/auth-admin/auth-admin.service';
import { apiErrorBody } from '../../platform/errors/api-error-body';
import { CurrentUserId } from '../../platform/auth/request/current-user-id.decorator';
import {
  ChangeInterestsDto,
  ChangeStylesDto,
  ChangeVoiceDto,
  CompleteOnboardingDto,
} from './me.dto';
import { AccountDeletionService } from './account-deletion/account-deletion.service';
import { MeService } from './me.service';
import { OnboardingService } from '../onboarding/onboarding.service';
import { PreferencesUpdateService } from './preferences-update/preferences-update.service';

// The user is identified only by the verified token (CurrentUserId). Nothing in
// the body, query or headers can name or change the user.
// Responses are parsed with MeResponseSchema before they leave.
@Controller('me')
export class MeController {
  constructor(
    private readonly me: MeService,
    private readonly onboarding: OnboardingService,
    private readonly preferencesUpdate: PreferencesUpdateService,
    private readonly accountDeletion: AccountDeletionService,
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

  // The narrator only. The onboarding PUT is not used for this: it rewrites every
  // preference and runs the queue top-up.
  @Put('voice')
  @ZodSerializerDto(MeResponseSchema)
  changeVoice(@CurrentUserId() userId: string, @Body() body: ChangeVoiceDto): Promise<MeResponse> {
    return this.preferencesUpdate.changeVoice(userId, body);
  }

  // Both interest lists and nothing else. Not the onboarding PUT, for the same reasons.
  @Put('interests')
  @ZodSerializerDto(MeResponseSchema)
  changeInterests(
    @CurrentUserId() userId: string,
    @Body() body: ChangeInterestsDto,
  ): Promise<MeResponse> {
    return this.preferencesUpdate.changeInterests(userId, body);
  }

  // The story styles and nothing else. Not the onboarding PUT, for the same reasons.
  @Put('styles')
  @ZodSerializerDto(MeResponseSchema)
  changeStyles(
    @CurrentUserId() userId: string,
    @Body() body: ChangeStylesDto,
  ): Promise<MeResponse> {
    return this.preferencesUpdate.changeStyles(userId, body);
  }

  // Deletes the account. IRREVERSIBLE. No request or response body: the id comes from the
  // token alone. The typed email that confirms it is a check of the app only and is never
  // sent (owner, 2026-11-28). The code of the 503 is `auth_unavailable`: the one failure
  // the app can be told about is that the auth service did not answer; nothing changed.
  @Delete()
  @HttpCode(204)
  async deleteAccount(@CurrentUserId() userId: string): Promise<void> {
    try {
      await this.accountDeletion.deleteAccount(userId);
    } catch (error) {
      if (error instanceof AuthAdminError) {
        throw new ServiceUnavailableException(
          apiErrorBody(503, 'auth_unavailable', 'Account deletion is unavailable'),
        );
      }
      throw error;
    }
  }
}
