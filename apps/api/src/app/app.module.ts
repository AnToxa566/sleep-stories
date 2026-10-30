import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { AppService } from './app.service';
import { AppController } from './app.controller';
import { AuthModule } from './auth/auth.module';
import { envFilePaths, validateEnv } from './config/env';
import { InterestsModule } from './interests/interests.module';
import { MeModule } from './me/me.module';
import { PrismaModule } from './prisma/prisma.module';
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
    ValidationModule,
    AuthModule,
    UsersModule,
    MeModule,
    InterestsModule,
    VoicesModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
