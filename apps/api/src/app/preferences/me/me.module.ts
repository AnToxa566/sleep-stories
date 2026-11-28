import { Module } from '@nestjs/common';
import { QueueModule } from '../../queue/queue.module';
import { UsersModule } from '../users/users.module';
import { AccountDeletionService } from './account-deletion/account-deletion.service';
import { MeController } from './me.controller';
import { MeService } from './me.service';
import { OnboardingService } from '../onboarding/onboarding.service';
import { PreferencesUpdateService } from './preferences-update/preferences-update.service';

@Module({
  imports: [UsersModule, QueueModule],
  controllers: [MeController],
  providers: [MeService, OnboardingService, PreferencesUpdateService, AccountDeletionService],
})
export class MeModule {}
