import { Module } from '@nestjs/common';
import { GenerationModule } from '../generation/generation.module';
import { ListensModule } from '../listens/listens.module';
import { TopicSuggestService } from './suggest-topics/topic-suggest.service';
import { TopicsService } from './topic-list/topics.service';
import { TopicsController } from './topics.controller';

// The «Темы» list and «Подобрать темы». PrismaService and JobQueue come from the global
// PrismaModule and ProvidersModule.
@Module({
  imports: [GenerationModule, ListensModule],
  controllers: [TopicsController],
  providers: [TopicsService, TopicSuggestService],
})
export class TopicsModule {}
