import { Module } from '@nestjs/common';
import { GenerationJobsService } from './generation-jobs.service';
import { GenerationLimitsService } from './generation-limits.service';
import { QueueTopUpService } from './queue-top-up.service';

// PrismaService and JobQueue come from the global PrismaModule and ProvidersModule.
@Module({
  providers: [GenerationLimitsService, GenerationJobsService, QueueTopUpService],
  exports: [QueueTopUpService, GenerationJobsService, GenerationLimitsService],
})
export class QueueModule {}
