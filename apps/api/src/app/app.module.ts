import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { AppService } from './app.service';
import { AppController } from './app.controller';
import { AuthModule } from './auth/auth.module';
import { envFilePaths, validateEnv } from './config/env';
import { GenerationModule } from './generation/generation.module';
import { InterestsModule } from './interests/interests.module';
import { MeModule } from './me/me.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProvidersModule } from './providers/providers.module';
import { QueueModule } from './queue/queue.module';
import { UsersModule } from './users/users.module';
import { ValidationModule } from './validation/validation.module';
import { VoicesModule } from './voices/voices.module';

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
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
