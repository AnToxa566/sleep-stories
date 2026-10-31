import { TINY_MP3_FRAME_SECONDS, tinyMp3 } from '../../test-support/tiny-mp3';
import { AudioDurationReader } from './audio-duration';

// One real parse of a tiny MP3 built from bytes (see test-support/tiny-mp3.ts).

describe('AudioDurationReader', () => {
  const reader = new AudioDurationReader();

  it('reads the duration of a real MP3 in seconds', async () => {
    const seconds = await reader.read(tinyMp3(100));
    expect(seconds).toBeCloseTo(100 * TINY_MP3_FRAME_SECONDS, 1);
  });
});
