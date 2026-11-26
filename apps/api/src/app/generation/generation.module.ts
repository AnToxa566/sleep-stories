import { Module } from '@nestjs/common';
import { AudioDurationReader } from './audio-renderer/audio-duration';
import { AudioRendererService } from './audio-renderer/audio-renderer.service';
import { GenerationJobsService } from './jobs/generation-jobs.service';
import { GenerationLimitsService } from './limits/generation-limits.service';
import { StoryWriterService } from './story-writer/story-writer.service';
import { TopicSuggesterService } from './topic-suggester/topic-suggester.service';

// Generation: the limits, the job records and the three services that make content. The
// content services need no database; LlmProvider, TtsProvider and StorageService come from
// the global ProvidersModule, PrismaService from the global PrismaModule. The job handlers in
// `internal` assemble these.
@Module({
  providers: [
    GenerationLimitsService,
    GenerationJobsService,
    TopicSuggesterService,
    StoryWriterService,
    AudioDurationReader,
    AudioRendererService,
  ],
  exports: [
    GenerationLimitsService,
    GenerationJobsService,
    TopicSuggesterService,
    StoryWriterService,
    AudioRendererService,
  ],
})
export class GenerationModule {}
