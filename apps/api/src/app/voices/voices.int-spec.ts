import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { ApiErrorResponseSchema, VoicesResponseSchema } from '@sleep-stories/contracts';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import type { CryptoKey } from 'jose';
import { AccessTokenVerifier, JoseAccessTokenVerifier } from '../auth/access-token-verifier';
import { AppModule } from '../app.module';
import type { Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { assertLocalDatabase } from '../../test-support/assert-local-database';

// Runs against the REAL local database (seeded with `prisma-seed`) with the real
// AppModule. Only the key source of the access-token verifier is replaced, as in
// interests.int-spec.ts. The catalogue is not user data, so the tests create no users.
assertLocalDatabase();

const KID = 'int-test-key';
const SEEDED_ORDER = ['maxim', 'anna', 'lev', 'kate'];

let app: INestApplication;
let prisma: PrismaService;
let baseUrl: string;
let issuer: string;
let signingKey: CryptoKey;

async function tokenFor(userId: string): Promise<string> {
  return new SignJWT({ role: 'authenticated', email: `${userId}@example.test` })
    .setProtectedHeader({ alg: 'ES256', kid: KID })
    .setSubject(userId)
    .setIssuer(issuer)
    .setAudience('authenticated')
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(signingKey);
}

async function getVoices(token?: string) {
  const headers: Record<string, string> = {};
  if (token !== undefined) headers['authorization'] = `Bearer ${token}`;
  const response = await fetch(`${baseUrl}/api/voices`, { headers });
  const text = await response.text();
  return { status: response.status, text, json: JSON.parse(text) as unknown };
}

beforeAll(async () => {
  const pair = await generateKeyPair('ES256', { extractable: true });
  signingKey = pair.privateKey;
  const jwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(pair.publicKey)), kid: KID, alg: 'ES256', use: 'sig' }] });

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(AccessTokenVerifier)
    .useFactory({
      inject: [ConfigService],
      factory: (config: ConfigService<Env, true>) => {
        issuer = `${new URL(config.get('SUPABASE_URL', { infer: true })).origin}/auth/v1`;
        return new JoseAccessTokenVerifier({ keys: jwks, issuer });
      },
    })
    .compile();
  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api');
  app.useLogger(false);
  await app.listen(0);
  baseUrl = await app.getUrl();
  prisma = app.get(PrismaService);
});

afterEach(async () => {
  // A test that deactivates a voice restores it even when it fails.
  await prisma.voice.updateMany({ where: { slug: 'lev' }, data: { isActive: true } });
});

afterAll(async () => {
  await app?.close();
});

describe('GET /api/voices', () => {
  it('rejects a request without a token with 401 and the error schema body', async () => {
    const result = await getVoices();
    expect(result.status).toBe(401);
    expect(ApiErrorResponseSchema.parse(result.json)).toMatchObject({ statusCode: 401, code: 'unauthorized' });
  });

  it('returns exactly the active voices for an authenticated user, ordered by sort order', async () => {
    const result = await getVoices(await tokenFor(randomUUID()));
    expect(result.status).toBe(200);
    const body = VoicesResponseSchema.parse(result.json);
    expect(body.voices.map((voice) => voice.slug)).toEqual(SEEDED_ORDER);
    expect(body.voices[0]).toEqual({ slug: 'maxim', name: 'Максим', description: 'спокойный, размеренный' });
  });

  it('hides an inactive voice', async () => {
    await prisma.voice.update({ where: { slug: 'lev' }, data: { isActive: false } });
    const result = await getVoices(await tokenFor(randomUUID()));
    expect(result.status).toBe(200);
    const slugs = VoicesResponseSchema.parse(result.json).voices.map((voice) => voice.slug);
    expect(slugs).toEqual(['maxim', 'anna', 'kate']);
  });

  it('does not leak the provider, the provider voice ids or the sample path', async () => {
    const result = await getVoices(await tokenFor(randomUUID()));
    expect(result.status).toBe(200);
    const rows = await prisma.voice.findMany({ select: { providerVoiceId: true } });
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(result.text).not.toContain(row.providerVoiceId);
    }
    expect(result.text).not.toContain('elevenlabs');
    expect(result.text).not.toMatch(/sample|ttsProvider|providerVoiceId|sortOrder|isActive|"id"/);
  });
});
