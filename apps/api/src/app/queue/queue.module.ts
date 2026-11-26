import { Module } from '@nestjs/common';
import { GenerationModule } from '../generation/generation.module';
import { QueueContinueService } from './continue-night/queue-continue.service';
import { QueueEditService } from './edit/queue-edit.service';
import { GenerationStartService } from './generate/generation-start.service';
import { QueuePickService } from './pick/queue-pick.service';
import { QueueController } from './queue.controller';
import { QueueReadService } from './read/queue-read.service';
import { QueueRebuildService } from './rebuild/queue-rebuild.service';
import { QueueTopUpService } from './top-up/queue-top-up.service';

// The limits and the job records come from GenerationModule. PrismaService, JobQueue and
// StorageService come from the global PrismaModule and ProvidersModule.
@Module({
  imports: [GenerationModule],
  controllers: [QueueController],
  providers: [
    QueueTopUpService,
    QueueReadService,
    QueueEditService,
    GenerationStartService,
    QueuePickService,
    QueueContinueService,
    QueueRebuildService,
  ],
  exports: [QueueTopUpService],
})
export class QueueModule {}
