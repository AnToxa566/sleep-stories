import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import type { Env } from '../config/env';
import { resolveDatabaseSsl } from './database-tls';

// The only place that constructs the Prisma client and the pg adapter. Other
// code injects PrismaService.
//
// Runtime connects through DATABASE_URL (Supabase transaction pooler, 6543).
// - No `?pgbouncer=true`: the pg adapter does not use it.
// - No statementNameGenerator: the adapter does not need named prepared
//   statements to survive across pooled connections.
// - TLS is verified against the pinned Supabase root CA (`ssl: { ca }`), never
//   `rejectUnauthorized: false`, unless DATABASE_TLS=disabled-local-only. That
//   mode is accepted by the env schema only for a loopback database host outside
//   Cloud Run and production (local Supabase stack), and logs a warning. See
//   resolveDatabaseSsl. pg merges parameters from the connection string over
//   these options, so the env schema refuses any ssl* parameter in
//   DATABASE_URL; otherwise `?sslmode=disable` would silently switch TLS off.
// - connectionTimeoutMillis 10000: fail a stuck connect instead of hanging a
//   Cloud Run request. Costs a spurious failure if the pooler is slow to answer.
// - Pool size is left at the pg default (10). How it relates to Cloud Run
//   concurrency is an open problem (ARCHITECTURE.md section 11).
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor(config: ConfigService<Env, true>) {
    const ssl = resolveDatabaseSsl({ mode: config.get('DATABASE_TLS', { infer: true }) });
    super({
      adapter: new PrismaPg({
        connectionString: config.get('DATABASE_URL', { infer: true }),
        ssl,
        connectionTimeoutMillis: 10_000,
      }),
    });
    if (ssl === false) {
      // One warning, without the host or URL.
      this.logger.warn('Database TLS is disabled (plaintext, local development only)');
    }
  }

  async onModuleInit(): Promise<void> {
    try {
      // A connectivity smoke test: it proves the pooler accepts the connection and
      // answers queries. It does not test prepared-statement behaviour: the pg
      // adapter sends unnamed statements. Two calls only show that a second query
      // on the pool also works.
      await this.$queryRaw`SELECT 1`;
      await this.$queryRaw`SELECT 1`;
    } catch (error) {
      // Log only the error class and code. Messages from the driver can contain
      // the host or user name.
      const code = (error as { code?: unknown }).code;
      this.logger.error(
        `Database connection check failed (${error instanceof Error ? error.name : 'Error'}${typeof code === 'string' ? `, ${code}` : ''})`,
      );
      throw new Error('Database connection check failed');
    }
    this.logger.log('Database connection verified');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
