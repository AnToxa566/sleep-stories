import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { RunJobResponseSchema } from '@sleep-stories/contracts';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import type { CryptoKey } from 'jose';
import type { z } from 'zod';
import { assertLocalDatabase } from '../../test-support/assert-local-database';
import { QueueTestData } from '../../test-support/queue-test-data';
import { tinyMp3 } from '../../test-support/tiny-mp3';
import { AccessTokenVerifier, JoseAccessTokenVerifier } from '../auth/access-token-verifier';
import { AppModule } from '../app.module';
import type { Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { LocalDispatchSecret } from '../providers/job-queue/local-dispatch-secret';
import {
  LlmProvider,
  LlmProviderError,
  type GenerateStructuredInput,
  type GenerateStructuredResult,
  type GenerateTextInput,
  type GenerateTextResult,
} from '../providers/llm/llm.provider';
import { StorageService } from '../providers/storage/storage.service';
import { TtsProvider, type SynthesizeInput, type SynthesizeResult } from '../providers/tts/tts.provider';
import { GenerationLimitsService } from '../queue/generation-limits.service';
import { QueueTopUpService } from '../queue/queue-top-up.service';

// The first end-to-end generation: the real AppModule against the REAL local database,
// listening on a random port, JOB_QUEUE=local (jobs are dispatched over real HTTP by the
// local queue, and run by the real handlers), with the two paid providers and the Storage
// upload replaced by fakes. Nothing here can reach Anthropic, ElevenLabs or Storage; the
// real AudioDurationReader parses the fake MP3.
//
// AppModule validates the environment once, when the file is first imported, so setting
// process.env before compile() would change nothing. As in internal-jobs.int-spec.ts the
// instance gets a ConfigService that answers JOB_QUEUE=local and everything else as the real
// one does, so the real factories run.
//
// Everything is made with random ids, and the topics the handlers create carry a per-run
// title prefix (the fake model writes it), which is how cleanup finds them.
assertLocalDatabase();

jest.setTimeout(120_000);

const KID = 'int-test-key';
const RUN = '/api/internal/jobs/run';
const RUN_ID = randomUUID().slice(0, 8);
const PREFIX = `e2e${RUN_ID} `;

// The fake model. It reads the tagged lists of the user message the way the real model
// would, answers with canned data and records every call, so the tests can assert on what
// each call was shown. It never sees a network.
class FakeLlm extends LlmProvider {
  structuredCalls: { system: string; user: string }[] = [];
  textCalls: { system: string; user: string }[] = [];
  // When true every story write fails with a retryable provider error.
  failWrites = false;
  // The catalogue slug that the fake answers in call B topics (the "bad" model answer).
  catalogueSlugForB: string | null = null;
  // Titles that call B answered with a catalogue slug.
  slugAnswered: string[] = [];
  private counter = 0;

  reset(): void {
    this.structuredCalls = [];
    this.textCalls = [];
    this.failWrites = false;
    this.catalogueSlugForB = null;
    this.slugAnswered = [];
  }

  async generateStructured<S extends z.ZodType>(
    input: GenerateStructuredInput<S>,
  ): Promise<GenerateStructuredResult<S>> {
    this.structuredCalls.push({ system: input.system, user: input.user });
    const styles = block(input.user, 'styles');
    const slugs = block(input.user, 'interests')
      .filter((line) => line.includes(': '))
      .map((line) => line.split(': ')[0]);
    const topics: { title: string; style: string; interest: string | null }[] = [];
    if (slugs.length > 0) {
      // Call A: catalogue topics, each with one of the offered slugs.
      for (let i = 0; i < 10; i += 1) {
        topics.push({
          title: this.nextTitle('a'),
          style: styles[i % styles.length],
          interest: slugs[i % slugs.length],
        });
      }
    } else {
      // Call B: the person's own words. Half of the answers wrongly carry a catalogue slug
      // when the test asks for it.
      for (let i = 0; i < 8; i += 1) {
        const wrong = i % 2 === 1 ? this.catalogueSlugForB : null;
        const title = this.nextTitle('b');
        if (wrong !== null) this.slugAnswered.push(title);
        topics.push({ title, style: styles[i % styles.length], interest: wrong });
      }
    }
    return { value: input.schema.parse({ topics }), model: 'fake-llm' };
  }

  async generateText(input: GenerateTextInput): Promise<GenerateTextResult> {
    this.textCalls.push({ system: input.system, user: input.user });
    if (this.failWrites) {
      throw new LlmProviderError(true, 529);
    }
    return { text: 'Тихая ночь над озером. '.repeat(40), model: 'fake-llm', truncated: false };
  }

  private nextTitle(part: 'a' | 'b'): string {
    this.counter += 1;
    return `${PREFIX}${part}-${this.counter}`;
  }
}

function block(message: string, tag: string): string[] {
  const match = new RegExp(`<${tag}>\\n([\\s\\S]*?)\\n</${tag}>`).exec(message);
  if (match === null) return [];
  return match[1].split('\n').filter((line) => line !== '(нет)');
}

class FakeTts extends TtsProvider {
  calls: { providerVoiceId: string; length: number }[] = [];

  async synthesize(input: SynthesizeInput): Promise<SynthesizeResult> {
    this.calls.push({ providerVoiceId: input.providerVoiceId, length: input.text.length });
    return { audio: tinyMp3(40), mimeType: 'audio/mpeg', provider: 'elevenlabs', model: 'fake-tts' };
  }
}

const llm = new FakeLlm();
const tts = new FakeTts();
const uploaded: string[] = [];
const fakeStorage = {
  uploadAudio: async (path: string): Promise<void> => {
    uploaded.push(path);
  },
};

let app: INestApplication;
let baseUrl: string;
let prisma: PrismaService;
let data: QueueTestData;
let topUp: QueueTopUpService;
let limits: GenerationLimitsService;
let secret: string;
let userKey: CryptoKey;
let issuer: string;
const userIds: string[] = [];

async function userToken(userId: string): Promise<string> {
  return new SignJWT({ role: 'authenticated', email: `${userId}@example.test` })
    .setProtectedHeader({ alg: 'ES256', kid: KID })
    .setSubject(userId)
    .setIssuer(issuer)
    .setAudience('authenticated')
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(userKey);
}

async function runJob(jobId: string): Promise<{ status: number; json: unknown }> {
  const response = await fetch(`${baseUrl}${RUN}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
    body: JSON.stringify({ jobId }),
  });
  const text = await response.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: response.status, json };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(condition: () => Promise<boolean>, timeoutMs = 30_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) return true;
    await sleep(150);
  }
  return false;
}

const activeJobs = (userId: string) =>
  prisma.generationJob.count({
    where: { requestedByUserId: userId, status: { in: ['pending', 'running'] } },
  });

// True once the person has jobs and none of them is pending or running. A write job creates
// its render job, and a suggestion creates its write jobs, in the transaction that finishes
// it, so there is no moment between two steps with nothing active.
async function settled(userId: string): Promise<boolean> {
  const ok = await waitFor(async () => {
    const total = await prisma.generationJob.count({ where: { requestedByUserId: userId } });
    return total > 0 && (await activeJobs(userId)) === 0;
  });
  return ok;
}

async function person(options: {
  voiceId: string;
  interestIds: string[];
  custom?: string[];
}): Promise<string> {
  const userId = await data.user({ voiceId: options.voiceId, interestIds: options.interestIds });
  userIds.push(userId);
  if (options.custom !== undefined && options.custom.length > 0) {
    await prisma.userCustomInterest.createMany({
      data: options.custom.map((title, index) => ({
        userId,
        title,
        createdAt: new Date(Date.now() + index),
      })),
    });
  }
  return userId;
}

async function queueOf(userId: string) {
  return prisma.queueItem.findMany({
    where: { userId },
    orderBy: { position: 'asc' },
    select: {
      topicId: true,
      topic: { select: { story: { select: { id: true, audio: { select: { voiceId: true } } } } } },
    },
  });
}

// Every queue item has a story and audio in the voice.
function expectReady(items: Awaited<ReturnType<typeof queueOf>>, voiceId: string): void {
  for (const item of items) {
    expect(item.topic.story).not.toBeNull();
    expect(item.topic.story?.audio.map((audio) => audio.voiceId)).toEqual([voiceId]);
  }
}

// Each succeeded write_story has a render_audio job for its story and voice that was
// created in the very transaction that finished it: created_at and finished_at are both
// now(), and now() is the transaction start, so they are equal.
async function expectChained(userId: string, voiceId: string): Promise<void> {
  const writes = await prisma.generationJob.findMany({
    where: { requestedByUserId: userId, kind: 'write_story', status: 'succeeded' },
  });
  const renders = await prisma.generationJob.findMany({
    where: { requestedByUserId: userId, kind: 'render_audio' },
  });
  expect(writes.length).toBeGreaterThan(0);
  for (const write of writes) {
    const topicId = (write.payload as { topicId: string }).topicId;
    const story = await prisma.story.findUniqueOrThrow({ where: { topicId }, select: { id: true } });
    const render = renders.find((job) => {
      const payload = job.payload as { storyId: string; voiceId: string };
      return payload.storyId === story.id && payload.voiceId === voiceId;
    });
    expect(render).toBeDefined();
    expect(render?.createdAt.getTime()).toBe(write.finishedAt?.getTime());
  }
}

beforeAll(async () => {
  const pair = await generateKeyPair('ES256', { extractable: true });
  userKey = pair.privateKey;
  const jwks = createLocalJWKSet({
    keys: [{ ...(await exportJWK(pair.publicKey)), kid: KID, alg: 'ES256', use: 'sig' }],
  });
  // The real ConfigService, to wrap. The probe is never initialised, so it connects to nothing.
  const probe = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const baseConfig = probe.get(ConfigService);
  await probe.close();
  const config = new Proxy(baseConfig, {
    get: (target, property) =>
      property === 'get'
        ? (key: string, ...rest: unknown[]) =>
            key === 'JOB_QUEUE'
              ? 'local'
              : (target.get as (...args: unknown[]) => unknown)(key, ...rest)
        : Reflect.get(target, property),
  });
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ConfigService)
    .useValue(config)
    .overrideProvider(LlmProvider)
    .useValue(llm)
    .overrideProvider(TtsProvider)
    .useValue(tts)
    .overrideProvider(StorageService)
    .useValue(fakeStorage)
    .overrideProvider(AccessTokenVerifier)
    .useFactory({
      inject: [ConfigService],
      factory: (cfg: ConfigService<Env, true>) => {
        issuer = `${new URL(cfg.get('SUPABASE_URL', { infer: true })).origin}/auth/v1`;
        return new JoseAccessTokenVerifier({ keys: jwks, issuer });
      },
    })
    .compile();
  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api'); // main.ts does this; the test app has to as well
  app.useLogger(false);
  await app.listen(0);
  baseUrl = await app.getUrl();
  prisma = app.get(PrismaService);
  topUp = app.get(QueueTopUpService);
  limits = app.get(GenerationLimitsService);
  secret = app.get(LocalDispatchSecret).value;
  data = new QueueTestData(prisma);
});

beforeEach(() => {
  llm.reset();
  tts.calls = [];
  uploaded.length = 0;
});

afterAll(async () => {
  if (prisma !== undefined) {
    // Best effort: let anything still running finish, so it cannot re-create rows.
    await waitFor(async () => {
      const active = await prisma.generationJob.count({
        where: { requestedByUserId: { in: userIds }, status: { in: ['pending', 'running'] } },
      });
      return active === 0;
    }, 10_000);
    await prisma.generationJob.deleteMany({ where: { requestedByUserId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    const mine = { topic: { title: { startsWith: PREFIX } } };
    await prisma.storyAudio.deleteMany({ where: { story: mine } });
    await prisma.story.deleteMany({ where: mine });
    await prisma.topic.deleteMany({ where: { title: { startsWith: PREFIX } } });
    if (data !== undefined) await data.cleanup();
  }
  await app?.close();
});

describe('the whole pipeline over real HTTP', () => {
  it('fills an empty queue: suggestion, stories and audio, three ready items', async () => {
    const voiceId = await data.voice();
    const interestId = await data.interest();
    const userId = await person({ voiceId, interestIds: [interestId] });
    const voice = await prisma.voice.findUniqueOrThrow({ where: { id: voiceId } });

    const result = await topUp.run(userId);
    expect(result.skipped).toBeUndefined();
    expect(await settled(userId)).toBe(true);

    const jobs = await prisma.generationJob.findMany({ where: { requestedByUserId: userId } });
    expect(jobs.map((job) => job.kind).sort()).toEqual([
      'render_audio',
      'render_audio',
      'render_audio',
      'suggest_topics',
      'write_story',
      'write_story',
      'write_story',
    ]);
    expect(jobs.every((job) => job.status === 'succeeded' && job.lastError === null)).toBe(true);

    const items = await queueOf(userId);
    expect(items).toHaveLength(3);
    expectReady(items, voiceId);
    await expectChained(userId, voiceId);

    const usage = await prisma.$transaction((tx) => limits.usage(tx, userId));
    expect(usage).toEqual({ rendersUsed: 3, suggestionsUsed: 1 });

    // One suggestion call, three story calls, three TTS calls in the person's voice, three
    // uploads. Topics were proposed to the person and nothing else.
    expect(llm.structuredCalls).toHaveLength(1);
    expect(llm.textCalls).toHaveLength(3);
    expect(tts.calls.map((call) => call.providerVoiceId)).toEqual([
      voice.providerVoiceId,
      voice.providerVoiceId,
      voice.providerVoiceId,
    ]);
    expect(uploaded).toHaveLength(3);
    const proposed = await prisma.userTopic.count({ where: { userId, reason: 'proposed' } });
    expect(proposed).toBe(10);
  });

  it('keeps a typed interest out of the catalogue call and out of other people (privacy)', async () => {
    const voiceId = await data.voice();
    const interestId = await data.interest();
    const interest = await prisma.interest.findUniqueOrThrow({ where: { id: interestId } });
    const customText = `кофе ${RUN_ID} старые поезда`;
    const first = await person({ voiceId, interestIds: [interestId], custom: [customText] });
    llm.catalogueSlugForB = interest.slug;

    // The person has history: an ordinary catalogue topic, a topic grown from the typed
    // interests (NULL interest) and a topic they requested by typing. All three are dismissed,
    // so the top-up does not queue them and still asks for new topics.
    const titleOf = async (topicId: string) =>
      (await prisma.topic.findUniqueOrThrow({ where: { id: topicId } })).title;
    const ordinary = await data.topic({ interestId });
    const grownFromTyped = await data.topic({ interestId: null });
    const requested = await data.topic({ interestId });
    await data.userTopic(first, ordinary.topicId, 'proposed', { dismissed: true });
    await data.userTopic(first, grownFromTyped.topicId, 'proposed', { dismissed: true });
    await data.userTopic(first, requested.topicId, 'requested', { dismissed: true });
    const ordinaryTitle = await titleOf(ordinary.topicId);
    const privateTitles = [await titleOf(grownFromTyped.topicId), await titleOf(requested.topicId)];

    await topUp.run(first);
    expect(await settled(first)).toBe(true);

    // What each call was shown. A: catalogue only. B: typed only, plus A's titles.
    expect(llm.structuredCalls).toHaveLength(2);
    const [callA, callB] = llm.structuredCalls;
    expect(callA.user).toContain(`${interest.slug}: ${interest.title}`);
    expect(callA.user).not.toContain(customText);
    expect(callA.user).toContain('<custom_interests>\n(нет)\n</custom_interests>');
    expect(callB.user).toContain(customText);
    expect(callB.user).not.toContain(interest.slug);
    expect(callB.user).not.toContain(interest.title);
    expect(callB.user).toContain('<interests>\n(нет)\n</interests>');
    expect(callB.user).toContain(`${PREFIX}a-`);
    // The "existing topics" of call A hold the ordinary catalogue title and neither the title
    // grown from typed interests nor the one the person typed; call B holds all three.
    expect(callA.user).toContain(ordinaryTitle);
    for (const title of privateTitles) expect(callA.user).not.toContain(title);
    expect(callB.user).toContain(ordinaryTitle);
    for (const title of privateTitles) expect(callB.user).toContain(title);
    // The system prompts hold no person's text.
    expect(callA.system).not.toContain(customText);
    expect(callB.system).not.toContain(customText);

    // Call B topics are stored with a NULL interest. The model answered a catalogue slug for
    // some of them; the ones that carried it were dropped, the others were kept.
    const own = await prisma.userTopic.findMany({
      where: { userId: first },
      select: { topic: { select: { id: true, title: true, interestId: true } } },
    });
    const typedTopics = own.map((row) => row.topic).filter((topic) => topic.title.startsWith(`${PREFIX}b-`));
    expect(llm.slugAnswered.length).toBeGreaterThan(0);
    expect(typedTopics.length).toBe(8 - llm.slugAnswered.length);
    expect(typedTopics.every((topic) => topic.interestId === null)).toBe(true);
    expect(typedTopics.some((topic) => llm.slugAnswered.includes(topic.title))).toBe(false);
    const catalogueTopics = own.map((row) => row.topic).filter((topic) => topic.title.startsWith(`${PREFIX}a-`));
    expect(catalogueTopics.length).toBe(10);
    expect(catalogueTopics.every((topic) => topic.interestId === interestId)).toBe(true);
    const nullTopicIds = typedTopics.map((topic) => topic.id);

    // Make every typed topic a complete one (a story and audio in the shared voice), so that
    // a second person with the same styles, interest and voice would be offered it if the pool
    // matched a NULL interest. Their catalogue topics are dismissed for the second person, so
    // that the only thing left to offer is what must never be offered.
    for (const topicId of nullTopicIds) {
      const story = await prisma.story.findUnique({ where: { topicId }, select: { id: true } });
      if (story === null) await data.storyFor(topicId, [voiceId]);
    }
    const second = await person({ voiceId, interestIds: [interestId] });
    for (const topic of catalogueTopics) {
      await data.userTopic(second, topic.id, 'proposed', { dismissed: true });
    }

    const result = await topUp.run(second);
    expect(result.skipped).toBeUndefined();
    if (result.skipped === undefined) {
      expect(result.queued).toEqual({ ready: 0, rendering: 0, writing: 0 });
    }
    expect(await settled(second)).toBe(true);

    const secondQueue = await prisma.queueItem.findMany({ where: { userId: second } });
    expect(secondQueue.length).toBe(3);
    expect(secondQueue.some((item) => nullTopicIds.includes(item.topicId))).toBe(false);
    const secondTopics = await prisma.userTopic.findMany({ where: { userId: second } });
    expect(secondTopics.some((row) => nullTopicIds.includes(row.topicId))).toBe(false);
  });

  it('queues only what the render limit allows, and only topics that have a job', async () => {
    const voiceId = await data.voice();
    const interestId = await data.interest();
    const userId = await person({ voiceId, interestIds: [interestId] });
    for (let i = 0; i < 4; i += 1) {
      await data.job({ userId, kind: 'render_audio', status: 'succeeded', hoursAgo: 1 });
    }

    await topUp.run(userId);
    expect(await settled(userId)).toBe(true);

    const writes = await prisma.generationJob.findMany({
      where: { requestedByUserId: userId, kind: 'write_story' },
    });
    expect(writes).toHaveLength(1);
    const items = await queueOf(userId);
    expect(items).toHaveLength(1);
    expect((writes[0].payload as { topicId: string }).topicId).toBe(items[0].topicId);
    expectReady(items, voiceId);
    await expectChained(userId, voiceId);
    // The other topics stay proposed, without a queue item.
    expect(await prisma.userTopic.count({ where: { userId, reason: 'proposed' } })).toBe(10);
    const usage = await prisma.$transaction((tx) => limits.usage(tx, userId));
    expect(usage.rendersUsed).toBe(5);
  });

  it('fails a story for good after three attempts, drops its queue item and never offers it again', async () => {
    const voiceId = await data.voice();
    const interestId = await data.interest();
    const userId = await person({ voiceId, interestIds: [interestId] });
    llm.failWrites = true;

    await topUp.run(userId);
    // The local queue retries after a pause of seconds; delivering again at once is what the
    // queue would do, and a delivery that finds a live run answers "try again later" and
    // changes nothing.
    const allFailed = await waitFor(async () => {
      const writes = await prisma.generationJob.findMany({
        where: { requestedByUserId: userId, kind: 'write_story' },
        select: { id: true, status: true },
      });
      if (writes.length > 0 && writes.every((job) => job.status === 'failed')) return true;
      for (const job of writes) {
        if (job.status === 'pending') await runJob(job.id);
      }
      return false;
    });
    expect(allFailed).toBe(true);

    const writes = await prisma.generationJob.findMany({
      where: { requestedByUserId: userId, kind: 'write_story' },
    });
    expect(writes).toHaveLength(3);
    expect(writes.every((job) => job.attempts === 3 && job.lastError !== null)).toBe(true);
    const failedTopicIds = writes.map((job) => (job.payload as { topicId: string }).topicId);
    expect(await prisma.queueItem.count({ where: { userId } })).toBe(0);
    expect(await prisma.generationJob.count({ where: { requestedByUserId: userId, kind: 'render_audio' } })).toBe(0);
    expect(await prisma.story.count({ where: { topicId: { in: failedTopicIds } } })).toBe(0);
    expect(llm.textCalls).toHaveLength(9);

    // A second top-up (the model works again) does not offer the failed topics.
    llm.failWrites = false;
    await topUp.run(userId);
    expect(await settled(userId)).toBe(true);
    const items = await prisma.queueItem.findMany({ where: { userId } });
    expect(items.length).toBe(3);
    expect(items.some((item) => failedTopicIds.includes(item.topicId))).toBe(false);
    expect(await prisma.userTopic.count({ where: { userId, topicId: { in: failedTopicIds } } })).toBe(3);
  });

  it('answers a repeated delivery of a finished job with finished and creates nothing more', async () => {
    const voiceId = await data.voice();
    const interestId = await data.interest();
    const userId = await person({ voiceId, interestIds: [interestId] });
    await topUp.run(userId);
    expect(await settled(userId)).toBe(true);

    const storiesBefore = await prisma.story.count({ where: { topic: { title: { startsWith: PREFIX } } } });
    const audioBefore = await prisma.storyAudio.count({ where: { story: { topic: { title: { startsWith: PREFIX } } } } });
    const jobsBefore = await prisma.generationJob.count({ where: { requestedByUserId: userId } });
    const callsBefore = { text: llm.textCalls.length, structured: llm.structuredCalls.length, tts: tts.calls.length };

    const jobs = await prisma.generationJob.findMany({ where: { requestedByUserId: userId } });
    expect(jobs).toHaveLength(7);
    for (const job of jobs) {
      const answer = await runJob(job.id);
      expect(answer.status).toBe(200);
      expect(RunJobResponseSchema.parse(answer.json)).toEqual({ status: 'finished' });
    }

    expect(await prisma.story.count({ where: { topic: { title: { startsWith: PREFIX } } } })).toBe(storiesBefore);
    expect(await prisma.storyAudio.count({ where: { story: { topic: { title: { startsWith: PREFIX } } } } })).toBe(audioBefore);
    expect(await prisma.generationJob.count({ where: { requestedByUserId: userId } })).toBe(jobsBefore);
    expect({ text: llm.textCalls.length, structured: llm.structuredCalls.length, tts: tts.calls.length }).toEqual(
      callsBefore,
    );
  });

  it('starts the first stories when onboarding completes through the real endpoint', async () => {
    const voiceId = await data.voice();
    const interestId = await data.interest();
    const voice = await prisma.voice.findUniqueOrThrow({ where: { id: voiceId } });
    const interest = await prisma.interest.findUniqueOrThrow({ where: { id: interestId } });
    const userId = randomUUID();
    userIds.push(userId);

    const response = await fetch(`${baseUrl}/api/me/onboarding`, {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${await userToken(userId)}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        voiceSlug: voice.slug,
        styles: ['facts'],
        interestSlugs: [interest.slug],
      }),
    });
    expect(response.status).toBe(200);

    // The suggestion job exists as soon as the response is back (the top-up ran after the
    // commit and before the response).
    const suggestions = await prisma.generationJob.count({
      where: { requestedByUserId: userId, kind: 'suggest_topics' },
    });
    expect(suggestions).toBe(1);
    expect(await settled(userId)).toBe(true);

    const items = await queueOf(userId);
    expect(items).toHaveLength(3);
    expectReady(items, voiceId);
    await expectChained(userId, voiceId);
  });
});
