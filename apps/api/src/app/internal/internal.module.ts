import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env';
import { LocalDispatchSecret } from '../providers/job-queue/local-dispatch-secret';
import { InternalController } from './internal.controller';
import {
  createInternalCredentialVerifier,
  googleKeySet,
  InternalCredentialVerifier,
} from './internal-credential.verifier';
import { JOB_HANDLERS, JobHandlerRegistry } from './job-handler';
import { JobRunnerService } from './job-runner.service';
import { JobSweeperService } from './job-sweeper.service';

// 'local' mode never reaches the Google verifier (see createInternalCredentialVerifier);
// if it ever did, verification would fail closed (an unavailable key set denies).
const noGoogleKeys = async (): Promise<never> => {
  throw new Error('No Google key set in local mode');
};

// The endpoints that Cloud Tasks and Cloud Scheduler call (SECURITY.md rule 4). PrismaService,
// JobQueue and LocalDispatchSecret come from the global PrismaModule and ProvidersModule.
@Module({
  controllers: [InternalController],
  providers: [
    JobRunnerService,
    JobSweeperService,
    JobHandlerRegistry,
    // Cycle 3b-2 registers the real handlers (suggest_topics, write_story, render_audio) here.
    // Until then the runner answers `retry` (HTTP 503) for every job and touches no row.
    { provide: JOB_HANDLERS, useValue: [] },
    {
      // InternalAuthGuard (applied by @InternalRoute()) is resolved from this module, so
      // the verifier lives here. The LocalDispatchSecret is the very instance that the
      // local job queue sends, shared through the global ProvidersModule.
      provide: InternalCredentialVerifier,
      inject: [ConfigService, LocalDispatchSecret],
      useFactory: (config: ConfigService<Env, true>, secret: LocalDispatchSecret) => {
        const mode = config.get('JOB_QUEUE', { infer: true });
        return createInternalCredentialVerifier({
          mode,
          audience: config.get('INTERNAL_OIDC_AUDIENCE', { infer: true }),
          serviceAccountEmail: config.get('INTERNAL_OIDC_SERVICE_ACCOUNT', { infer: true }),
          // Only the modes that verify Google tokens build the remote key set; a local run
          // never does. The key set fetches nothing until the first token is verified.
          keys: mode === 'local' ? noGoogleKeys : googleKeySet(),
          secret,
        });
      },
    },
  ],
})
export class InternalModule {}
