import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app/app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const globalPrefix = 'api';
  app.setGlobalPrefix(globalPrefix);
  // Without this, SIGTERM (which Cloud Run sends on scale-down and on a new revision)
  // kills the process before onModuleDestroy runs, so the database pool is never
  // closed. Costs a few milliseconds at shutdown.
  app.enableShutdownHooks();
  const port = process.env.PORT || 3000;
  // 0.0.0.0, not the default: inside a container the port must be reachable from outside
  // it, and Cloud Run (and the phone on the LAN in development) connect from outside.
  await app.listen(port, '0.0.0.0');
  Logger.log(`Application is listening on port ${port}, path /${globalPrefix}`);
}

bootstrap();
