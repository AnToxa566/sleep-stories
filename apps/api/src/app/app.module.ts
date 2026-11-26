import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { AppService } from './app.service';
import { AppController } from './app.controller';
import { AuthModule } from './platform/auth/auth.module';
import { envFilePaths, validateEnv } from './platform/config/env';
import { GenerationModule } from './generation/generation.module';
import { InterestsModule } from './preferences/interests/interests.module';
import { InternalModule } from './internal/internal.module';
import { ListensModule } from './listens/listens.module';
import { MeModule } from './preferences/me/me.module';
import { PrismaModule } from './platform/prisma/prisma.module';
import { ProvidersModule } from './providers/providers.module';
import { QueueModule } from './queue/queue.module';
import { TopicsModule } from './topics/topics.module';
import { UsersModule } from './preferences/users/users.module';
import { ValidationModule } from './platform/validation/validation.module';
import { VoicesModule } from './preferences/voices/voices.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: envFilePaths(),
      validate: validateEnv,
    }),
    PrismaModule,
    ProvidersModule,
    ValidationModule,
    AuthModule,
    UsersModule,
    MeModule,
    InterestsModule,
    VoicesModule,
    GenerationModule,
    QueueModule,
    TopicsModule,
    ListensModule,
    InternalModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
