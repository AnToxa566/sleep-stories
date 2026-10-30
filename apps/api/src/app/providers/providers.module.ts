import { Global, Module } from '@nestjs/common';
import { StorageService } from './storage/storage.service';

// Adapters for services that hold provider keys. Global so a feature module can inject
// an adapter without importing this module; the LLM and TTS adapters join here later.
@Global()
@Module({
  providers: [StorageService],
  exports: [StorageService],
})
export class ProvidersModule {}
