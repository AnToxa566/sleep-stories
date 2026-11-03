import { Module } from '@nestjs/common';
import { GenerationJobsService } from './generation-jobs.service';
import { GenerationLimitsService } from './generation-limits.service';
import { GenerationStartService } from './generation-start.service';
import { QueueContinueService } from './queue-continue.service';
import { QueueEditService } from './queue-edit.service';
import { QueuePickService } from './queue-pick.service';
import { QueueReadService } from './queue-read.service';
import { QueueRebuildService } from './queue-rebuild.service';
import { QueueTopUpService } from './queue-top-up.service';
import { QueueController } from './queue.controller';
import { TopicsController } from './topics.controller';
import { TopicsService } from './topics.service';

// PrismaService, JobQueue and StorageService come from the global PrismaModule and
// ProvidersModule.
@Module({
  controllers: [QueueController, TopicsController],
  providers: [
    GenerationLimitsService,
    GenerationJobsService,
    QueueTopUpService,
    QueueReadService,
    QueueEditService,
    GenerationStartService,
    QueuePickService,
    QueueContinueService,
    QueueRebuildService,
    TopicsService,
  ],
  exports: [QueueTopUpService, GenerationJobsService, GenerationLimitsService],
})
export class QueueModule {}
