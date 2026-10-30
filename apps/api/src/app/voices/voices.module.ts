import { Module } from '@nestjs/common';
import { VoicesController } from './voices.controller';
import { VoicesService } from './voices.service';

@Module({
  controllers: [VoicesController],
  providers: [VoicesService],
})
export class VoicesModule {}
