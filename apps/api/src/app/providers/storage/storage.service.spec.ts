import { ConfigService } from '@nestjs/config';
import { createClient } from '@supabase/supabase-js';
import type { Env } from '../../config/env';
import { StorageService, StorageSigningError, StorageUploadError, storyAudioPath } from './storage.service';

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn() }));

// Fake values that exist only in this file.
const URL_VALUE = 'http://storage-host.test:54321';
const KEY = 'fake-service-role-key-for-unit-tests';
const BUCKET = 'bucket-under-test';

type Item = { error: string | null; path: string | null; signedUrl: string | null };

function makeService(
  result: { data: Item[] | null; error: unknown },
  publicUrl?: string,
  uploadResult: { data: unknown; error: unknown } = { data: { path: 'x' }, error: null },
) {
  const createSignedUrls = jest.fn(async () => result);
  const upload = jest.fn<Promise<typeof uploadResult>, [string, Buffer, object]>(async () => uploadResult);
  const from = jest.fn(() => ({ createSignedUrls, upload }));
  (createClient as jest.Mock).mockReturnValue({ storage: { from } });
  const values: Record<string, string> = { SUPABASE_URL: URL_VALUE, SUPABASE_SERVICE_ROLE_KEY: KEY, AUDIO_BUCKET: BUCKET };
  if (publicUrl !== undefined) {
    values['STORAGE_PUBLIC_URL'] = publicUrl;
  }
  const config = { get: (name: string) => values[name] } as unknown as ConfigService<Env, true>;
  return { service: new StorageService(config), createSignedUrls, from, upload };
}

const ok = (path: string): Item => ({ error: null, path, signedUrl: `${URL_VALUE}/storage/v1/object/sign/${BUCKET}/${path}?token=t` });

describe('StorageService.signMany', () => {
  beforeEach(() => jest.clearAllMocks());

  it('builds a server client without a session from the configured URL and key', () => {
    makeService({ data: [], error: null });
    expect(createClient).toHaveBeenCalledWith(URL_VALUE, KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  });

  it('signs all paths in one batched call on the configured bucket and keeps the input order', async () => {
    const { service, createSignedUrls, from } = makeService({ data: [ok('b'), ok('a')], error: null });
    const urls = await service.signMany(['a', 'b'], 600);
    expect(from).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledWith(BUCKET);
    expect(createSignedUrls).toHaveBeenCalledTimes(1);
    expect(createSignedUrls).toHaveBeenCalledWith(['a', 'b'], 600);
    expect(urls).toEqual([ok('a').signedUrl, ok('b').signedUrl]);
  });

  it('makes no request for an empty list', async () => {
    const { service, createSignedUrls } = makeService({ data: [], error: null });
    expect(await service.signMany([], 600)).toEqual([]);
    expect(createSignedUrls).not.toHaveBeenCalled();
  });

  it.each([
    ['a top-level error', { data: null, error: { message: `leaks ${KEY} ${URL_VALUE}` } }],
    ['a per-item error', { data: [ok('a'), { error: 'Object not found', path: 'b', signedUrl: null }], error: null }],
    ['an item without a URL', { data: [ok('a'), { error: null, path: 'b', signedUrl: null }], error: null }],
    ['a missing item', { data: [ok('a')], error: null }],
    ['an unexpected path in the result', { data: [ok('a'), ok('c')], error: null }],
  ])('fails with a generic error on %s, without any secret, URL or path in it', async (_name, result) => {
    const { service } = makeService(result);
    const failure = await service.signMany(['a', 'b'], 600).then(
      () => null,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(StorageSigningError);
    const text = `${(failure as Error).message} ${(failure as Error).stack ?? ''}`;
    for (const secret of [KEY, URL_VALUE, BUCKET, 'Object not found']) {
      expect(text).not.toContain(secret);
    }
    expect((failure as Error).message).toBe('Storage signing failed');
  });
});

describe('StorageService.signMany with STORAGE_PUBLIC_URL', () => {
  beforeEach(() => jest.clearAllMocks());

  it('replaces protocol, host and port of every URL and keeps path and query', async () => {
    const { service } = makeService({ data: [ok('a/b.mp3'), ok('c.mp3')], error: null }, 'https://phone.test');
    const urls = await service.signMany(['a/b.mp3', 'c.mp3'], 600);
    expect(urls).toEqual([
      `https://phone.test/storage/v1/object/sign/${BUCKET}/a/b.mp3?token=t`,
      `https://phone.test/storage/v1/object/sign/${BUCKET}/c.mp3?token=t`,
    ]);
  });

  it('uses the port of the public origin', async () => {
    const { service } = makeService({ data: [ok('a')], error: null }, 'http://192.168.1.20:54321');
    expect(await service.signMany(['a'], 600)).toEqual([`http://192.168.1.20:54321/storage/v1/object/sign/${BUCKET}/a?token=t`]);
  });

  it('does not keep the old port when the public origin has none', async () => {
    const { service } = makeService({ data: [ok('a')], error: null }, 'http://phone.test');
    const [url] = await service.signMany(['a'], 600);
    expect(new URL(url).port).toBe('');
    expect(new URL(url).host).toBe('phone.test');
  });

  it('leaves the URLs untouched when it is not set', async () => {
    const { service } = makeService({ data: [ok('a')], error: null });
    expect(await service.signMany(['a'], 600)).toEqual([ok('a').signedUrl]);
  });

  it('fails with the generic error when a signed URL does not parse', async () => {
    const bad: Item = { error: null, path: 'a', signedUrl: 'not a url ' + KEY };
    const { service } = makeService({ data: [bad], error: null }, 'http://192.168.1.20:54321');
    const failure = await service.signMany(['a'], 600).then(
      () => null,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(StorageSigningError);
    expect((failure as Error).message).toBe('Storage signing failed');
    expect(`${(failure as Error).message} ${(failure as Error).stack ?? ''}`).not.toContain(KEY);
  });
});

describe('StorageService.uploadAudio', () => {
  beforeEach(() => jest.clearAllMocks());

  it('uploads the bytes to the configured bucket with the content type and upsert on', async () => {
    const { service, from, upload } = makeService({ data: [], error: null });
    const bytes = Buffer.from([1, 2, 3]);
    await expect(service.uploadAudio('stories/a/b.mp3', bytes, 'audio/mpeg')).resolves.toBeUndefined();
    expect(from).toHaveBeenCalledWith(BUCKET);
    expect(upload).toHaveBeenCalledWith('stories/a/b.mp3', bytes, { contentType: 'audio/mpeg', upsert: true });
  });

  it('fails with a generic error that carries no secret, URL, bucket, path or storage text', async () => {
    const { service } = makeService({ data: [], error: null }, undefined, {
      data: null,
      error: { message: `leaks ${KEY} ${URL_VALUE} Bucket not found` },
    });
    const failure = await service.uploadAudio('stories/secret-path.mp3', Buffer.from([1]), 'audio/mpeg').then(
      () => null,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(StorageUploadError);
    const text = `${(failure as Error).message} ${(failure as Error).stack ?? ''}`;
    for (const secret of [KEY, URL_VALUE, BUCKET, 'secret-path', 'Bucket not found']) {
      expect(text).not.toContain(secret);
    }
    expect((failure as Error).message).toBe('Storage upload failed');
  });
});

describe('storyAudioPath', () => {
  const STORY = '3f2b8c1e-5a47-4d9e-9b6a-1c2d3e4f5a6b';
  const VOICE = 'A1B2C3D4-0000-4000-8000-000000000001';

  it('builds a deterministic path from the two ids, lower-cased', () => {
    expect(storyAudioPath(STORY, VOICE)).toBe(`stories/${STORY}/a1b2c3d4-0000-4000-8000-000000000001.mp3`);
    expect(storyAudioPath(STORY, VOICE)).toBe(storyAudioPath(STORY, VOICE));
  });

  it.each([
    ['', VOICE],
    ['not-a-uuid', VOICE],
    [STORY, ''],
    [`${STORY}/../x`, VOICE],
    [STORY, `${VOICE}.mp3`],
    [`../${STORY.slice(3)}`, VOICE],
    [`${STORY}\n`, VOICE],
  ])('throws for the invalid ids (%j, %j) without echoing them', (story, voice) => {
    expect(() => storyAudioPath(story, voice)).toThrow('storyAudioPath requires UUID arguments');
    try {
      storyAudioPath(story, voice);
    } catch (error) {
      expect((error as Error).message).not.toContain('..');
    }
  });
});
