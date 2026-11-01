import { Module } from '@nestjs/common';
import { ListensController } from './listens.controller';
import { ListensService } from './listens.service';

// PrismaService comes from the global PrismaModule.
@Module({
  controllers: [ListensController],
  providers: [ListensService],
})
export class ListensModule {}
