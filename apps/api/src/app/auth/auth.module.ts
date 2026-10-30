import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { createRemoteJWKSet } from 'jose';
import type { Env } from '../config/env';
import { AccessTokenVerifier, JoseAccessTokenVerifier } from './access-token-verifier';
import { JwtAuthGuard } from './jwt-auth.guard';

@Module({
  providers: [
    {
      provide: AccessTokenVerifier,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): AccessTokenVerifier => {
        // SUPABASE_URL is an origin (checked in env.ts), so this is
        // <origin>/auth/v1 for both the issuer and the key set.
        const authUrl = `${new URL(config.get('SUPABASE_URL', { infer: true })).origin}/auth/v1`;
        return new JoseAccessTokenVerifier({
          issuer: authUrl,
          // jose caches the key set (10 minutes), and after a successful fetch it
          // refetches for an unknown kid at most every 30 seconds. That cooldown does
          // not apply while the fetches are failing: then every request starts a
          // fetch (requests that overlap share one) and there is no backoff during
          // an Auth outage. Each fetch waits at most the 5 s timeout, which bounds
          // how long a request can wait on Auth before answering 503.
          keys: createRemoteJWKSet(new URL(`${authUrl}/.well-known/jwks.json`), { timeoutDuration: 5_000 }),
        });
      },
    },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
  exports: [AccessTokenVerifier],
})
export class AuthModule {}
