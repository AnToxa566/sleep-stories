import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import type { CryptoKey } from 'jose';
import { AppModule } from '../app/app.module';
import { AccessTokenVerifier, JoseAccessTokenVerifier } from '../app/auth/access-token-verifier';
import type { Env } from '../app/config/env';
import { PrismaService } from '../app/prisma/prisma.service';
import { StorageService } from '../app/providers/storage/storage.service';
import { assertLocalDatabase } from './assert-local-database';
import { QueueTestData } from './queue-test-data';

// Boots the real AppModule against the local database for an HTTP integration spec. Only the
// key source of the access-token verifier is replaced (so a test signs its own tokens) and
// StorageService is a mock that returns opaque URLs. Used by the specs of cycle 4b; older
// specs carry their own copy and are not changed.
const KID = 'int-test-key';

export interface HttpResult {
  status: number;
  text: string;
  json: unknown;
}

export interface Harness {
  app: INestApplication;
  prisma: PrismaService;
  data: QueueTestData;
  tokenFor(userId: string): Promise<string>;
  // `userId` undefined sends no token.
  call(method: string, path: string, userId?: string, body?: unknown): Promise<HttpResult>;
  requestWhileLockHeld(userId: string, fire: () => Promise<HttpResult>): Promise<{
    response: HttpResult;
    insertedId: string;
  }>;
  close(): Promise<void>;
}

export async function startHarness(): Promise<Harness> {
  assertLocalDatabase();
  const pair = await generateKeyPair('ES256', { extractable: true });
  const signingKey: CryptoKey = pair.privateKey;
  const jwks = createLocalJWKSet({
    keys: [{ ...(await exportJWK(pair.publicKey)), kid: KID, alg: 'ES256', use: 'sig' }],
  });
  let issuer = '';
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(AccessTokenVerifier)
    .useFactory({
      inject: [ConfigService],
      factory: (config: ConfigService<Env, true>) => {
        issuer = `${new URL(config.get('SUPABASE_URL', { infer: true })).origin}/auth/v1`;
        return new JoseAccessTokenVerifier({ keys: jwks, issuer });
      },
    })
    .overrideProvider(StorageService)
    .useValue({
      signMany: async (paths: readonly string[]) =>
        paths.map((_path, index) => `https://signed.example.test/opaque-${index}?token=fake`),
    })
    .compile();
  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api');
  app.useLogger(false);
  await app.listen(0);
  const baseUrl = await app.getUrl();
  const prisma = app.get(PrismaService);
  const data = new QueueTestData(prisma);

  const tokenFor = (userId: string) =>
    new SignJWT({ role: 'authenticated', email: `${userId}@example.test` })
      .setProtectedHeader({ alg: 'ES256', kid: KID })
      .setSubject(userId)
      .setIssuer(issuer)
      .setAudience('authenticated')
      .setIssuedAt()
      .setExpirationTime('10m')
      .sign(signingKey);

  const call: Harness['call'] = async (method, path, userId, body) => {
    const headers: Record<string, string> = {};
    if (userId !== undefined) headers['authorization'] = `Bearer ${await tokenFor(userId)}`;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const response = await fetch(`${baseUrl}/api${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    return { status: response.status, text, json: JSON.parse(text) as unknown };
  };

  // Proves a route takes the users-row lock. Holds `SELECT ... FOR UPDATE` on the person's
  // `users` row in an open transaction, fires the request WITHOUT awaiting it, waits until a
  // backend is seen waiting on that lock (pg_stat_activity), and only then inserts a queue
  // item at max+1 (as the top-up does) and commits. A route that takes the lock reads and
  // writes after that insert; a route that does not has already finished, or never waits.
  const requestWhileLockHeld: Harness['requestWhileLockHeld'] = async (userId, fire) => {
    const extra = await data.topic();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let locked!: () => void;
    const lockTaken = new Promise<void>((resolve) => {
      locked = resolve;
    });
    let insertedId = '';
    const holder = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
        locked();
        await gate;
        const max = await tx.queueItem.aggregate({ where: { userId }, _max: { position: true } });
        const row = await tx.queueItem.create({
          data: { userId, topicId: extra.topicId, position: (max._max.position ?? 0) + 1 },
          select: { id: true },
        });
        insertedId = row.id;
      },
      { timeout: 30_000 },
    );
    let pending: Promise<HttpResult> | undefined;
    let waitingSeen = false;
    try {
      await lockTaken;
      pending = fire();
      for (let attempt = 0; attempt < 100 && !waitingSeen; attempt++) {
        const rows = await prisma.$queryRaw<{ n: number }[]>`
          SELECT count(*)::int AS n FROM pg_stat_activity
          WHERE wait_event_type = 'Lock'
            AND query ILIKE '%FROM users%FOR UPDATE%'
            AND pid <> pg_backend_pid()
        `;
        waitingSeen = rows[0].n > 0;
        if (!waitingSeen) await new Promise((resolve) => setTimeout(resolve, 50));
      }
    } finally {
      release();
      await holder;
    }
    if (!waitingSeen) {
      await pending;
      throw new Error('The request was never seen waiting on the users-row lock: it did not take it');
    }
    return { response: await (pending as Promise<HttpResult>), insertedId };
  };

  return {
    app,
    prisma,
    data,
    tokenFor,
    call,
    requestWhileLockHeld,
    close: async () => {
      await data.cleanup();
      await app.close();
    },
  };
}
