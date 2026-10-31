import { randomUUID } from 'node:crypto';
import { INestApplication, Logger } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { GenerationJobPayload } from '@sleep-stories/contracts';
import { assertLocalDatabase } from '../../../test-support/assert-local-database';
import { QueueTestData } from '../../../test-support/queue-test-data';
import { envFilePaths, validateEnv } from '../../config/env';
import type {
  AudioRendererService,
  RenderAudioInput,
  RenderAudioResult,
} from '../../generation/audio-renderer.service';
import type {
  StoryWriterService,
  WriteStoryInput,
  WriteStoryResult,
} from '../../generation/story-writer.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { PrismaService } from '../../prisma/prisma.service';
import type { JobQueue } from '../../providers/job-queue/job-queue';
import { LlmProviderError } from '../../providers/llm/llm.provider';
import { TtsProviderError } from '../../providers/tts/tts.provider';
import { dedupeKeyOf, GenerationJobsService } from '../../queue/generation-jobs.service';
import { JobHandlerRegistry, type JobHandler } from '../job-handler';
import { JobRunnerService } from '../job-runner.service';
import { RenderAudioHandler } from './render-audio.handler';
import { WriteStoryHandler } from './write-story.handler';

// Runs against the REAL local database with the real PrismaModule. The story writer, the
// audio renderer and the job queue are fakes that record their calls: no provider, no
// storage. Every test builds its own voice, people and topics with random ids.
assertLocalDatabase();

const STORY_TEXT = 'Жил-был маяк на краю света. '.repeat(20).trim();

let app: INestApplication;
let prisma: PrismaService;
let data: QueueTestData;
let runner: JobRunnerService;
let jobsService: GenerationJobsService;

// Topics made by these tests: the stories the handlers create for them are removed at the end.
const topicIds: string[] = [];

type Impl<I, O> = (input: I) => Promise<O>;
const defaultWrite: Impl<WriteStoryInput, WriteStoryResult> = async () => ({
  text: STORY_TEXT,
  model: 'fake-model',
  promptVersion: 'fake-prompt-v1',
});
const defaultRender: Impl<RenderAudioInput, RenderAudioResult> = async (input) => ({
  storagePath: `test/${input.storyId}/${input.voice.id}.mp3`,
  durationSec: 321,
  byteSize: 4567,
  mimeType: 'audio/mpeg',
  ttsProvider: 'fake-tts',
});

let writeImpl = defaultWrite;
let renderImpl = defaultRender;
let writeCalls: WriteStoryInput[] = [];
let renderCalls: RenderAudioInput[] = [];
let enqueued: string[] = [];
// What the database showed at the moment each id was handed to the queue.
let seenAtEnqueue: { jobStatus: string | undefined; renderJobStatus: string | undefined }[] = [];
let enqueueImpl: (jobId: string) => Promise<void> = async () => undefined;
let logged: string[] = [];

const writer = {
  write: async (input: WriteStoryInput) => {
    writeCalls.push(input);
    return writeImpl(input);
  },
} as unknown as StoryWriterService;

const renderer = {
  render: async (input: RenderAudioInput) => {
    renderCalls.push(input);
    return renderImpl(input);
  },
} as unknown as AudioRendererService;

let currentWriteJobId: string | null = null;
const queue: JobQueue = {
  enqueue: async (jobId) => {
    // The handler enqueues after its transaction: from another connection the new job and
    // the finished write_story job must both be visible already.
    const render = await prisma.generationJob.findUnique({
      where: { id: jobId },
      select: { status: true },
    });
    const write =
      currentWriteJobId === null
        ? null
        : await prisma.generationJob.findUnique({
            where: { id: currentWriteJobId },
            select: { status: true },
          });
    seenAtEnqueue.push({ jobStatus: write?.status, renderJobStatus: render?.status });
    enqueued.push(jobId);
    await enqueueImpl(jobId);
  },
};

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, envFilePath: envFilePaths(), validate: validateEnv }),
      PrismaModule,
    ],
  }).compile();
  app = moduleRef.createNestApplication();
  await app.init();
  prisma = app.get(PrismaService);
  data = new QueueTestData(prisma);
  jobsService = new GenerationJobsService();
  runner = new JobRunnerService(
    prisma,
    // A handler for one kind is not assignable to the wide JobHandler type (the parameter
    // is checked contravariantly), hence the cast; Nest does not type-check `inject` either.
    new JobHandlerRegistry([
      new WriteStoryHandler(prisma, writer, jobsService, queue),
      new RenderAudioHandler(prisma, renderer),
    ] as unknown as JobHandler[]),
  );
});

afterAll(async () => {
  // The handlers' own rows first (stories and audio of the topics made here), then the rest
  // in the order QueueTestData.cleanup uses (jobs by requester, users, ...).
  await prisma.storyAudio.deleteMany({ where: { story: { topicId: { in: topicIds } } } });
  await prisma.story.deleteMany({ where: { topicId: { in: topicIds } } });
  await data.cleanup();
  await app.close();
});

beforeEach(() => {
  writeImpl = defaultWrite;
  renderImpl = defaultRender;
  writeCalls = [];
  renderCalls = [];
  enqueued = [];
  seenAtEnqueue = [];
  enqueueImpl = async () => undefined;
  currentWriteJobId = null;
  logged = [];
  for (const method of ['log', 'warn', 'error', 'debug', 'verbose', 'fatal'] as const) {
    jest.spyOn(Logger.prototype, method).mockImplementation((...args: unknown[]) => {
      logged.push(JSON.stringify(args));
    });
  }
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function topic(options: Parameters<QueueTestData['topic']>[0] = {}) {
  const made = await data.topic(options);
  topicIds.push(made.topicId);
  return made;
}

// A person with preferences and a voice.
async function person() {
  const voiceId = await data.voice();
  const userId = await data.user({ voiceId });
  return { voiceId, userId };
}

async function makeJob(
  userId: string,
  payload: GenerationJobPayload,
  options: { requester?: 'user' | 'none' } = {},
): Promise<string> {
  const id = await data.job({
    userId,
    kind: payload.kind,
    status: 'pending',
    payload,
    dedupeKey: dedupeKeyOf(userId, payload),
  });
  if (options.requester === 'none') {
    await prisma.$executeRaw`
      UPDATE generation_jobs SET requested_by_user_id = NULL WHERE id = ${id}::uuid`;
  }
  if (payload.kind === 'write_story') {
    currentWriteJobId = id;
  }
  return id;
}

const readJob = (id: string) => prisma.generationJob.findUniqueOrThrow({ where: { id } });
const renderJobsOf = (userId: string) =>
  prisma.generationJob.findMany({ where: { requestedByUserId: userId, kind: 'render_audio' } });
const storyOf = (topicId: string) => prisma.story.findUnique({ where: { topicId } });
const audioOf = (storyId: string) => prisma.storyAudio.findMany({ where: { storyId } });

// What a second delivery writes when it takes the job over while this run is still busy.
async function takeOver(jobId: string): Promise<void> {
  await prisma.$executeRaw`
    UPDATE generation_jobs SET attempts = attempts + 1, started_at = now()
    WHERE id = ${jobId}::uuid`;
}

describe('WriteStoryHandler (database)', () => {
  it('stores the story and creates the render job for the requester, with the success', async () => {
    const { voiceId, userId } = await person();
    const { topicId } = await topic({ style: 'facts' });
    const topicRow = await prisma.topic.findUniqueOrThrow({ where: { id: topicId } });
    const jobId = await makeJob(userId, { kind: 'write_story', topicId, voiceId });

    await expect(runner.run(jobId)).resolves.toBe('succeeded');

    expect(writeCalls).toEqual([{ style: 'facts', topicTitle: topicRow.title }]);
    const story = await storyOf(topicId);
    expect(story).toMatchObject({
      topicId,
      text: STORY_TEXT,
      charCount: STORY_TEXT.length,
      llmModel: 'fake-model',
      promptVersion: 'fake-prompt-v1',
    });
    expect(await readJob(jobId)).toMatchObject({ status: 'succeeded', attempts: 1 });
    const renderJobs = await renderJobsOf(userId);
    expect(renderJobs).toHaveLength(1);
    const payload = { kind: 'render_audio', storyId: story?.id, voiceId };
    expect(renderJobs[0]).toMatchObject({
      status: 'pending',
      payload,
      dedupeKey: `render_audio:${story?.id}:${voiceId}`,
      requestedByUserId: userId,
    });
    // Handed to the queue once, after the commit: both rows were visible by then.
    expect(enqueued).toEqual([renderJobs[0].id]);
    expect(seenAtEnqueue).toEqual([{ jobStatus: 'succeeded', renderJobStatus: 'pending' }]);
    expect(logged).toEqual([]);
  });

  it('persists neither the story nor the render job when the lease was lost (atomicity)', async () => {
    const { voiceId, userId } = await person();
    const { topicId } = await topic();
    const jobId = await makeJob(userId, { kind: 'write_story', topicId, voiceId });
    writeImpl = async (input) => {
      await takeOver(jobId);
      return defaultWrite(input);
    };

    await expect(runner.run(jobId)).resolves.toBe('finished');

    expect(await storyOf(topicId)).toBeNull();
    expect(await renderJobsOf(userId)).toEqual([]);
    expect(enqueued).toEqual([]);
    expect(await readJob(jobId)).toMatchObject({ status: 'running', attempts: 2, lastError: null });
  });

  it('rolls the story and the success back when the render job cannot be created', async () => {
    const { voiceId, userId } = await person();
    const { topicId } = await topic();
    const jobId = await makeJob(userId, { kind: 'write_story', topicId, voiceId });
    jest.spyOn(jobsService, 'create').mockRejectedValue(new Error('insert failed'));

    await expect(runner.run(jobId)).resolves.toBe('failed');

    // Nothing of the transaction survived: no story, no success, no render job.
    expect(await storyOf(topicId)).toBeNull();
    expect(await readJob(jobId)).toMatchObject({ status: 'failed', lastError: 'unknown' });
    expect(await renderJobsOf(userId)).toEqual([]);
    expect(enqueued).toEqual([]);
  });

  it('keeps the committed result when handing the render job to the queue fails', async () => {
    const { voiceId, userId } = await person();
    const { topicId } = await topic();
    const jobId = await makeJob(userId, { kind: 'write_story', topicId, voiceId });
    enqueueImpl = async () => {
      throw new Error('queue down: https://secret.example/token');
    };

    await expect(runner.run(jobId)).resolves.toBe('succeeded');

    expect(await readJob(jobId)).toMatchObject({ status: 'succeeded' });
    expect(await storyOf(topicId)).not.toBeNull();
    const renderJobs = await renderJobsOf(userId);
    expect(renderJobs).toHaveLength(1);
    expect(renderJobs[0].status).toBe('pending');
    // Exactly one fixed line: no id, no error text.
    expect(logged).toEqual([
      JSON.stringify(['Enqueueing a generation job failed; it stays pending']),
    ]);
  });

  it('skips the model call when the topic already has a story, and still creates the render job', async () => {
    const { voiceId, userId } = await person();
    const { topicId, storyId } = await topic({ story: true });
    const jobId = await makeJob(userId, { kind: 'write_story', topicId, voiceId });

    await expect(runner.run(jobId)).resolves.toBe('succeeded');

    expect(writeCalls).toEqual([]);
    // The existing story is untouched.
    expect(await storyOf(topicId)).toMatchObject({ id: storyId, text: 'test story' });
    const renderJobs = await renderJobsOf(userId);
    expect(renderJobs).toHaveLength(1);
    expect(renderJobs[0].payload).toEqual({ kind: 'render_audio', storyId, voiceId });
    expect(enqueued).toEqual([renderJobs[0].id]);
  });

  it('creates no render job when the story already has audio in that voice', async () => {
    const { voiceId, userId } = await person();
    const { topicId } = await topic({ audioVoiceIds: [voiceId] });
    const jobId = await makeJob(userId, { kind: 'write_story', topicId, voiceId });

    await expect(runner.run(jobId)).resolves.toBe('succeeded');

    expect(writeCalls).toEqual([]);
    expect(await renderJobsOf(userId)).toEqual([]);
    expect(enqueued).toEqual([]);
    expect(await readJob(jobId)).toMatchObject({ status: 'succeeded' });
  });

  it('enqueues nothing when an active render job with that key already exists', async () => {
    const { voiceId, userId } = await person();
    const other = await person();
    const { topicId, storyId } = await topic({ story: true });
    const existing = await makeJob(other.userId, {
      kind: 'render_audio',
      storyId: storyId as string,
      voiceId,
    });
    const jobId = await makeJob(userId, { kind: 'write_story', topicId, voiceId });

    await expect(runner.run(jobId)).resolves.toBe('succeeded');

    expect(await renderJobsOf(userId)).toEqual([]);
    expect(enqueued).toEqual([]);
    expect((await readJob(existing)).status).toBe('pending');
    expect(await readJob(jobId)).toMatchObject({ status: 'succeeded' });
  });

  it('stores the story but creates no render job when the requester is gone', async () => {
    const { voiceId, userId } = await person();
    const { topicId } = await topic();
    const jobId = await makeJob(userId, { kind: 'write_story', topicId, voiceId }, {
      requester: 'none',
    });

    await expect(runner.run(jobId)).resolves.toBe('succeeded');

    expect(await storyOf(topicId)).not.toBeNull();
    expect(await renderJobsOf(userId)).toEqual([]);
    expect(enqueued).toEqual([]);
    expect(await readJob(jobId)).toMatchObject({ status: 'succeeded', requestedByUserId: null });
  });

  it('fails at once with job_target_missing when the topic is gone', async () => {
    const { voiceId, userId } = await person();
    const unrelated = await topic();
    await data.queueItem(userId, unrelated.topicId, 1);
    const jobId = await makeJob(userId, { kind: 'write_story', topicId: randomUUID(), voiceId });

    await expect(runner.run(jobId)).resolves.toBe('failed');

    expect(writeCalls).toEqual([]);
    expect(await readJob(jobId)).toMatchObject({
      status: 'failed',
      attempts: 1,
      lastError: 'generation:job_target_missing',
    });
    // The failure policy removes only the items waiting on the missing topic (a queue item
    // cannot exist for a deleted topic: the foreign key forbids it).
    expect(await prisma.queueItem.count({ where: { userId } })).toBe(1);
    expect(await renderJobsOf(userId)).toEqual([]);
  });

  it('persists nothing and retries after a retryable model error', async () => {
    const { voiceId, userId } = await person();
    const { topicId } = await topic();
    const jobId = await makeJob(userId, { kind: 'write_story', topicId, voiceId });
    writeImpl = async () => {
      throw new LlmProviderError(true, 529);
    };

    await expect(runner.run(jobId)).resolves.toBe('retry');

    expect(await readJob(jobId)).toMatchObject({ status: 'pending', attempts: 1 });
    expect(await storyOf(topicId)).toBeNull();
    expect(await renderJobsOf(userId)).toEqual([]);
    expect(enqueued).toEqual([]);
  });
});

describe('RenderAudioHandler (database)', () => {
  it('stores the audio row with the renderer fields and marks the job succeeded', async () => {
    const { voiceId, userId } = await person();
    const { storyId } = await topic({ story: true });
    const voice = await prisma.voice.findUniqueOrThrow({ where: { id: voiceId } });
    const jobId = await makeJob(userId, {
      kind: 'render_audio',
      storyId: storyId as string,
      voiceId,
    });

    await expect(runner.run(jobId)).resolves.toBe('succeeded');

    expect(renderCalls).toEqual([
      {
        storyId,
        voice: { id: voiceId, providerVoiceId: voice.providerVoiceId },
        text: 'test story',
      },
    ]);
    const rows = await audioOf(storyId as string);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      storyId,
      voiceId,
      storagePath: `test/${storyId}/${voiceId}.mp3`,
      durationSec: 321,
      byteSize: 4567,
      mimeType: 'audio/mpeg',
      ttsProvider: 'fake-tts',
    });
    expect(await readJob(jobId)).toMatchObject({ status: 'succeeded', attempts: 1 });
    expect(logged).toEqual([]);
  });

  it('skips the renderer when the audio row already exists, and still marks success', async () => {
    const { voiceId, userId } = await person();
    const { storyId } = await topic({ audioVoiceIds: [voiceId] });
    const before = await audioOf(storyId as string);
    const jobId = await makeJob(userId, {
      kind: 'render_audio',
      storyId: storyId as string,
      voiceId,
    });

    await expect(runner.run(jobId)).resolves.toBe('succeeded');

    expect(renderCalls).toEqual([]);
    expect(await audioOf(storyId as string)).toEqual(before);
    expect(await readJob(jobId)).toMatchObject({ status: 'succeeded' });
  });

  it.each(['story', 'voice'] as const)(
    'fails at once with job_target_missing when the %s is gone',
    async (missing) => {
      const { voiceId, userId } = await person();
      const { storyId } = await topic({ story: true });
      const jobId = await makeJob(userId, {
        kind: 'render_audio',
        storyId: missing === 'story' ? randomUUID() : (storyId as string),
        voiceId: missing === 'voice' ? randomUUID() : voiceId,
      });

      await expect(runner.run(jobId)).resolves.toBe('failed');

      expect(renderCalls).toEqual([]);
      expect(await readJob(jobId)).toMatchObject({
        status: 'failed',
        attempts: 1,
        lastError: 'generation:job_target_missing',
      });
      expect(await audioOf(storyId as string)).toEqual([]);
    },
  );

  it('persists nothing and retries after a retryable provider error', async () => {
    const { voiceId, userId } = await person();
    const { storyId } = await topic({ story: true });
    const jobId = await makeJob(userId, {
      kind: 'render_audio',
      storyId: storyId as string,
      voiceId,
    });
    renderImpl = async () => {
      throw new TtsProviderError(true, 503);
    };

    await expect(runner.run(jobId)).resolves.toBe('retry');

    expect(await readJob(jobId)).toMatchObject({ status: 'pending', attempts: 1 });
    expect(await audioOf(storyId as string)).toEqual([]);
  });

  it('persists no audio row when the lease was lost (atomicity)', async () => {
    const { voiceId, userId } = await person();
    const { storyId } = await topic({ story: true });
    const jobId = await makeJob(userId, {
      kind: 'render_audio',
      storyId: storyId as string,
      voiceId,
    });
    renderImpl = async (input) => {
      await takeOver(jobId);
      return defaultRender(input);
    };

    await expect(runner.run(jobId)).resolves.toBe('finished');

    // The uploaded object stays in storage and is overwritten by the retry (deterministic
    // path); the database holds no row for it.
    expect(await audioOf(storyId as string)).toEqual([]);
    expect(await readJob(jobId)).toMatchObject({ status: 'running', attempts: 2, lastError: null });
  });
});
