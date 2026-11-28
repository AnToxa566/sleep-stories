import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { ApiErrorResponseSchema, TopicsResponseSchema } from '@sleep-stories/contracts';
import { startHarness, type Harness, type HttpResult } from '../../../../test-support/http-harness';
import { GenerationJobsService } from '../../../generation/jobs/generation-jobs.service';
import type { StoryWriterService } from '../../../generation/story-writer/story-writer.service';
import { WriteStoryHandler } from '../../../internal/handlers/write-story.handler';
import { JobHandlerRegistry, type JobHandler } from '../../../internal/runner/job-handler';
import { JobRunnerService } from '../../../internal/runner/job-runner.service';
import type { Env } from '../../../platform/config/env';
import { AuthAdminError, AuthAdminService } from '../../../providers/auth-admin/auth-admin.service';
import type { JobQueue } from '../../../providers/job-queue/job-queue';
import {
  findEligible,
  findReady,
  findWithoutAudio,
  findWithoutStory,
} from '../../../topics/candidates/topic-candidates';

// DELETE /api/me against the REAL local database. The auth admin adapter is the harness's
// fake: no test here can delete a real sign-in record.

let h: Harness;

beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => {
  await h.close();
});
beforeEach(() => {
  h.authAdmin.calls = [];
  h.authAdmin.behaviour = async () => undefined;
});

const deleteMe = (userId?: string) => h.call('DELETE', '/me', userId);

// A DELETE with whatever else a client might add to name another person.
async function deleteWith(userId: string, extra: { query?: string; body?: unknown; headers?: Record<string, string> }) {
  const response = await fetch(`${await h.app.getUrl()}/api/me${extra.query ?? ''}`, {
    method: 'DELETE',
    headers: {
      authorization: `Bearer ${await h.tokenFor(userId)}`,
      ...(extra.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...extra.headers,
    },
    body: extra.body === undefined ? undefined : JSON.stringify(extra.body),
  });
  return { status: response.status, text: await response.text() };
}

const TYPED = 'qt typed interest';

// A person with a row in every per-user table, and one topic grown from their typed
// interest in each state a story can be in.
async function person(shared: { voiceId: string; interestId: string }) {
  const userId = await h.data.user({
    voiceId: shared.voiceId,
    styles: ['facts'],
    interestIds: [shared.interestId],
  });
  await h.prisma.userCustomInterest.create({ data: { userId, title: TYPED } });

  const ready = await h.data.topic({ audioVoiceIds: [shared.voiceId] });
  const noAudio = await h.data.topic({ story: true });
  const noStory = await h.data.topic();
  for (const topic of [ready, noAudio, noStory]) {
    await h.data.userTopic(userId, topic.topicId, 'proposed');
  }
  await h.data.queueItem(userId, ready.topicId, 1);
  await h.data.queueItem(userId, noStory.topicId, 2);
  await h.data.listen(userId, ready.storyId as string, shared.voiceId, 5);
  await h.data.rating(userId, ready.storyId as string, 1);
  return { userId, ready, noAudio, noStory };
}

async function shared() {
  return { voiceId: await h.data.voice(), interestId: await h.data.interest() };
}

async function rowsOf(userId: string) {
  const where = { userId };
  return {
    users: await h.prisma.user.count({ where: { id: userId } }),
    userPreferences: await h.prisma.userPreference.count({ where }),
    userInterests: await h.prisma.userInterest.count({ where }),
    userCustomInterests: await h.prisma.userCustomInterest.count({ where }),
    userTopics: await h.prisma.userTopic.count({ where }),
    queueItems: await h.prisma.queueItem.count({ where }),
    listens: await h.prisma.listen.count({ where }),
    storyRatings: await h.prisma.storyRating.count({ where }),
  };
}

const NOTHING = {
  users: 0,
  userPreferences: 0,
  userInterests: 0,
  userCustomInterests: 0,
  userTopics: 0,
  queueItems: 0,
  listens: 0,
  storyRatings: 0,
};
const EVERYTHING = {
  users: 1,
  userPreferences: 1,
  userInterests: 1,
  userCustomInterests: 1,
  userTopics: 3,
  queueItems: 2,
  listens: 1,
  storyRatings: 1,
};

const jobRows = (ids: string[]) =>
  h.prisma.generationJob.findMany({
    where: { id: { in: ids } },
    select: { id: true, status: true, requestedByUserId: true },
    orderBy: { id: 'asc' },
  });

describe('authentication and the choice of the person', () => {
  it('answers 401 without a token and calls nothing', async () => {
    const reply = await deleteMe();
    expect(reply.status).toBe(401);
    expect(ApiErrorResponseSchema.parse(reply.json)).toMatchObject({ code: 'unauthorized' });
    expect(h.authAdmin.calls).toEqual([]);
  });

  it('ignores a user id in the query, the body and the headers', async () => {
    const s = await shared();
    const a = await person(s);
    const b = await person(s);

    const reply = await deleteWith(a.userId, {
      query: `?userId=${b.userId}&id=${b.userId}`,
      body: { userId: b.userId, id: b.userId, email: 'someone@example.test' },
      headers: { 'x-user-id': b.userId },
    });

    expect(reply).toEqual({ status: 204, text: '' });
    expect(h.authAdmin.calls).toEqual([a.userId]);
    expect(await rowsOf(a.userId)).toEqual(NOTHING);
    expect(await rowsOf(b.userId)).toEqual(EVERYTHING);
  });
});

describe('what is removed and what is kept', () => {
  it('empties every per-user table, keeps failed jobs without a requester, keeps content', async () => {
    const s = await shared();
    const a = await person(s);
    const b = await person(s);

    // A catalogue topic whose write job failed, and a story whose render in this voice
    // failed. Each has a healthy twin, so an exclusion below is the failed row's doing.
    const brokenWrite = await h.data.topic({ interestId: s.interestId, audioVoiceIds: [s.voiceId] });
    const healthyReady = await h.data.topic({ interestId: s.interestId, audioVoiceIds: [s.voiceId] });
    const brokenRender = await h.data.topic({ interestId: s.interestId, story: true });
    const healthyNoAudio = await h.data.topic({ interestId: s.interestId, story: true });

    const failedIds = [
      await h.data.job({
        userId: a.userId,
        kind: 'write_story',
        status: 'failed',
        dedupeKey: `write_story:${brokenWrite.topicId}`,
      }),
      await h.data.job({
        userId: a.userId,
        kind: 'render_audio',
        status: 'failed',
        dedupeKey: `render_audio:${brokenRender.storyId}:${s.voiceId}`,
      }),
      await h.data.job({ userId: a.userId, kind: 'suggest_topics', status: 'failed' }),
    ];
    const removedIds = [
      await h.data.job({ userId: a.userId, kind: 'suggest_topics', status: 'pending' }),
      await h.data.job({ userId: a.userId, kind: 'write_story', status: 'running' }),
      await h.data.job({ userId: a.userId, kind: 'render_audio', status: 'succeeded' }),
    ];
    const othersIds = [
      await h.data.job({ userId: b.userId, kind: 'write_story', status: 'pending' }),
      await h.data.job({ userId: b.userId, kind: 'render_audio', status: 'succeeded' }),
    ];

    const topics = [a.ready, a.noAudio, a.noStory, brokenWrite, healthyReady, brokenRender, healthyNoAudio];
    const topicIds = topics.map((t) => t.topicId);
    const content = async () => ({
      topics: await h.prisma.topic.count({ where: { id: { in: topicIds } } }),
      stories: await h.prisma.story.count({ where: { topicId: { in: topicIds } } }),
      audio: await h.prisma.storyAudio.count({ where: { story: { topicId: { in: topicIds } } } }),
    });
    const contentBefore = await content();
    const othersBefore = await jobRows(othersIds);

    expect((await deleteMe(a.userId)).status).toBe(204);

    expect(await rowsOf(a.userId)).toEqual(NOTHING);
    expect(await jobRows(removedIds)).toEqual([]);
    expect(await jobRows(failedIds)).toEqual(
      [...failedIds].sort().map((id) => ({ id, status: 'failed', requestedByUserId: null })),
    );
    expect(await content()).toEqual(contentBefore);
    expect(contentBefore).toEqual({ topics: 7, stories: 6, audio: 3 });
    expect(await rowsOf(b.userId)).toEqual(EVERYTHING);
    expect(await jobRows(othersIds)).toEqual(othersBefore);

    // The broken topic and the broken render are still offered to nobody.
    const query = { userId: b.userId, voiceId: s.voiceId, limit: 50, topicIds };
    const readyIds = (await findReady(h.prisma, query)).map((r) => r.topicId);
    expect(readyIds).toContain(healthyReady.topicId);
    expect(readyIds).not.toContain(brokenWrite.topicId);
    const noAudioIds = (await findWithoutAudio(h.prisma, query)).map((r) => r.topicId);
    expect(noAudioIds).toContain(healthyNoAudio.topicId);
    expect(noAudioIds).not.toContain(brokenRender.topicId);
  });

  it('offers nobody the kept topics that grew from the typed interests', async () => {
    const s = await shared();
    const a = await person(s);
    // The same catalogue interest, style, voice and typed words.
    const bId = await h.data.user({ voiceId: s.voiceId, styles: ['facts'], interestIds: [s.interestId] });
    await h.prisma.userCustomInterest.create({ data: { userId: bId, title: TYPED } });
    const control = await h.data.topic({ interestId: s.interestId, audioVoiceIds: [s.voiceId] });
    const kept = [a.ready.topicId, a.noAudio.topicId, a.noStory.topicId];

    expect((await deleteMe(a.userId)).status).toBe(204);

    // Kept, with a NULL interest and no row of anybody that leads to them.
    expect(await h.prisma.topic.count({ where: { id: { in: kept }, interestId: null } })).toBe(3);
    expect(await h.prisma.userTopic.count({ where: { topicId: { in: kept } } })).toBe(0);

    // The loosest options a caller can pass.
    const loosest = {
      userId: bId,
      voiceId: s.voiceId,
      limit: 50,
      topicIds: [...kept, control.topicId],
      includeOwn: true,
      includeQueued: true,
      includeFailed: true,
      heard: 'include' as const,
    };
    expect((await findReady(h.prisma, loosest)).map((r) => r.topicId)).toEqual([control.topicId]);
    expect(await findWithoutAudio(h.prisma, loosest)).toEqual([]);
    expect(await findWithoutStory(h.prisma, loosest)).toEqual([]);
    expect(await findEligible(h.prisma, loosest)).toEqual(new Set([control.topicId]));

    const list = await h.call('GET', '/topics', bId);
    expect(list.status).toBe(200);
    const listed = TopicsResponseSchema.parse(list.json);
    expect(list.text).toContain(control.topicId);
    for (const topicId of kept) {
      expect(JSON.stringify(listed)).not.toContain(topicId);
      const added = await h.call('POST', '/queue/items', bId, { topicIds: [topicId] });
      expect(added.status).toBe(404);
      expect(ApiErrorResponseSchema.parse(added.json)).toMatchObject({ code: 'topic_unavailable' });
    }
  });
});

describe('failures and repeats', () => {
  it('changes nothing and answers 503 when the auth call fails', async () => {
    const a = await person(await shared());
    const jobId = await h.data.job({ userId: a.userId, kind: 'write_story', status: 'pending' });
    h.authAdmin.behaviour = async () => {
      throw new AuthAdminError();
    };

    const reply = await deleteMe(a.userId);

    expect(reply.status).toBe(503);
    expect(ApiErrorResponseSchema.parse(reply.json)).toEqual({
      statusCode: 503,
      code: 'auth_unavailable',
      message: 'Account deletion is unavailable',
    });
    expect(await rowsOf(a.userId)).toEqual(EVERYTHING);
    expect(await jobRows([jobId])).toEqual([{ id: jobId, status: 'pending', requestedByUserId: a.userId }]);
  });

  it('answers 204 when the auth server says the user is already gone', async () => {
    const a = await person(await shared());
    // The real adapter and SDK against a stubbed host; every other request goes through.
    const values: Record<string, string> = {
      SUPABASE_URL: 'http://auth-gone.test',
      SUPABASE_SERVICE_ROLE_KEY: 'fake-key',
    };
    const adapter = new AuthAdminService({
      get: (name: string) => values[name],
    } as unknown as ConfigService<Env, true>);
    const realFetch = globalThis.fetch;
    let stubbed = 0;
    const spy = jest.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (!String(input).startsWith('http://auth-gone.test/')) return realFetch(input, init);
      stubbed += 1;
      return new Response(JSON.stringify({ error_code: 'user_not_found', msg: 'User not found' }), {
        status: 404,
      });
    });
    h.authAdmin.behaviour = (userId) => adapter.deleteUser(userId);
    try {
      expect((await deleteMe(a.userId)).status).toBe(204);
    } finally {
      spy.mockRestore();
    }
    expect(stubbed).toBe(1);
    expect(await rowsOf(a.userId)).toEqual(NOTHING);
  });

  it('answers 204 again, and for a person who never had a users row', async () => {
    const a = await person(await shared());
    expect((await deleteMe(a.userId)).status).toBe(204);
    expect((await deleteMe(a.userId)).status).toBe(204);
    const never = randomUUID();
    expect((await deleteMe(never)).status).toBe(204);
    expect(h.authAdmin.calls).toEqual([a.userId, a.userId, never]);
    expect(await rowsOf(a.userId)).toEqual(NOTHING);
    expect(await rowsOf(never)).toEqual(NOTHING);
  });

  it('lets a still-valid token recreate only an empty users row through GET /me', async () => {
    const s = await shared();
    const a = await person(s);
    expect((await deleteMe(a.userId)).status).toBe(204);

    expect((await h.call('GET', '/me', a.userId)).json).toEqual({
      onboardingCompleted: false,
      preferences: null,
    });
    // The settings routes need finished onboarding, so they bring nothing back.
    expect((await h.call('PUT', '/me/styles', a.userId, { styles: ['facts'] })).status).toBe(400);
    expect((await h.call('POST', '/queue/collect', a.userId)).status).toBeLessThan(500);
    expect(await rowsOf(a.userId)).toEqual({ ...NOTHING, users: 1 });
    expect(await h.prisma.generationJob.count({ where: { requestedByUserId: a.userId } })).toBe(0);
    await h.prisma.user.deleteMany({ where: { id: a.userId } });
  });
});

// Resolves once a backend is seen waiting for the users-row lock.
async function seeLockWait(): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt++) {
    const rows = await h.prisma.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM pg_stat_activity
      WHERE wait_event_type = 'Lock'
        AND query ILIKE '%FROM users%FOR UPDATE%'
        AND pid <> pg_backend_pid()
    `;
    if (rows[0].n > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('No request was seen waiting on the users-row lock');
}

function gate() {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { open, opened };
}

describe('races', () => {
  it('a generation start that waits on the deletion finds no row and creates no job', async () => {
    const a = await person(await shared());
    const inAuth = gate();
    const finishAuth = gate();
    // The deletion stops inside its transaction, holding the lock.
    h.authAdmin.behaviour = async () => {
      inAuth.open();
      await finishAuth.opened;
    };

    const deletion = deleteMe(a.userId);
    await inAuth.opened;
    let start: Promise<HttpResult>;
    try {
      start = h.call('POST', '/queue/generate', a.userId);
      await seeLockWait();
    } finally {
      finishAuth.open();
    }

    expect((await deletion).status).toBe(204);
    expect((await start).status).toBe(400);
    expect(await rowsOf(a.userId)).toEqual(NOTHING);
    expect(await h.prisma.generationJob.count({ where: { requestedByUserId: a.userId } })).toBe(0);
    expect(
      await h.prisma.generationJob.count({
        where: { dedupeKey: { in: [`write_story:${a.noStory.topicId}`] } },
      }),
    ).toBe(0);
  });

  // The person is deleted while the job's model or TTS call is in flight.
  async function deleteWhileRunning(userId: string, jobId: string, handler: (paused: () => Promise<void>) => JobHandler) {
    const inHandler = gate();
    const goOn = gate();
    const runner = new JobRunnerService(
      h.prisma,
      new JobHandlerRegistry([
        handler(async () => {
          inHandler.open();
          await goOn.opened;
        }),
      ]),
    );
    const run = runner.run(jobId);
    await inHandler.opened;
    try {
      expect((await deleteMe(userId)).status).toBe(204);
    } finally {
      goOn.open();
    }
    return run;
  }

  it('a running job that finishes after the deletion fails its fence and writes nothing', async () => {
    const s = await shared();
    const a = await person(s);
    const storyId = a.noAudio.storyId as string;
    const jobId = await h.data.job({
      userId: a.userId,
      kind: 'render_audio',
      status: 'pending',
      payload: { kind: 'render_audio', storyId, voiceId: s.voiceId },
    });

    const outcome = await deleteWhileRunning(a.userId, jobId, (paused) => ({
      kind: 'render_audio',
      run: async (ctx) => {
        await paused();
        await h.prisma.$transaction(async (tx) => {
          await tx.storyAudio.create({
            data: {
              storyId,
              voiceId: s.voiceId,
              storagePath: `test/${randomUUID()}.mp3`,
              durationSec: 60,
              byteSize: 1000,
              mimeType: 'audio/mpeg',
              ttsProvider: 'test',
            },
          });
          await ctx.markSucceeded(tx);
        });
      },
    }));

    expect(outcome).toBe('finished');
    expect(await h.prisma.storyAudio.count({ where: { storyId } })).toBe(0);
    expect(await jobRows([jobId])).toEqual([]);
  });

  it('a running write_story starts no next stage after the deletion', async () => {
    const s = await shared();
    const a = await person(s);
    const topicId = a.noStory.topicId;
    const jobId = await h.data.job({
      userId: a.userId,
      kind: 'write_story',
      status: 'pending',
      payload: { kind: 'write_story', topicId, voiceId: s.voiceId },
    });
    const enqueue = jest.fn(async () => undefined);

    const outcome = await deleteWhileRunning(a.userId, jobId, (paused) => {
      const writer = {
        write: async () => {
          await paused();
          return { text: 'test story', model: 'test', promptVersion: 'test' };
        },
      } as unknown as StoryWriterService;
      return new WriteStoryHandler(h.prisma, writer, new GenerationJobsService(), {
        enqueue,
      } as unknown as JobQueue) as unknown as JobHandler;
    });

    expect(outcome).toBe('finished');
    expect(enqueue).not.toHaveBeenCalled();
    expect(await h.prisma.story.count({ where: { topicId } })).toBe(0);
    expect(await h.prisma.generationJob.count({ where: { dedupeKey: { startsWith: `write_story:${topicId}` } } })).toBe(0);
    expect(await jobRows([jobId])).toEqual([]);
  });
});
