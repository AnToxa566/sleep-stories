import { Module } from '@nestjs/common';
import { AudioDurationReader } from './audio-duration';
import { AudioRendererService } from './audio-renderer.service';
import { StoryWriterService } from './story-writer.service';
import { TopicSuggesterService } from './topic-suggester.service';

// Building blocks for the generation jobs. They need no database; LlmProvider,
// TtsProvider and StorageService come from the global ProvidersModule. The job handlers
// (a later feature) will assemble these.
@Module({
  providers: [TopicSuggesterService, StoryWriterService, AudioRendererService, AudioDurationReader],
  exports: [TopicSuggesterService, StoryWriterService, AudioRendererService],
})
export class GenerationModule {}
