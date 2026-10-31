import { Module } from '@nestjs/common';
import { GenerationJobsService } from './generation-jobs.service';
import { GenerationLimitsService } from './generation-limits.service';
import { QueueEditService } from './queue-edit.service';
import { QueueReadService } from './queue-read.service';
import { QueueTopUpService } from './queue-top-up.service';
import { QueueController } from './queue.controller';

// PrismaService, JobQueue and StorageService come from the global PrismaModule and
// ProvidersModule.
@Module({
  controllers: [QueueController],
  providers: [
    GenerationLimitsService,
    GenerationJobsService,
    QueueTopUpService,
    QueueReadService,
    QueueEditService,
  ],
  exports: [QueueTopUpService, GenerationJobsService, GenerationLimitsService],
})
export class QueueModule {}
