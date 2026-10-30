import { AudioDurationReader } from './audio-duration';

// One real parse of a tiny MP3 built from bytes: MPEG-1 Layer III, 128 kbps, 44.1 kHz,
// no padding, mono-less stereo. Each frame is 417 bytes and lasts 1152 / 44100 s. The
// frame payload is zeros (silence-like data); the parser only walks the headers.
const FRAME_HEADER = [0xff, 0xfb, 0x90, 0x00];
const FRAME_BYTES = 417;
const FRAME_SECONDS = 1152 / 44100;

function mp3(frames: number): Buffer {
  const frame = Buffer.alloc(FRAME_BYTES);
  Buffer.from(FRAME_HEADER).copy(frame);
  return Buffer.concat(Array.from({ length: frames }, () => frame));
}

describe('AudioDurationReader', () => {
  const reader = new AudioDurationReader();

  it('reads the duration of a real MP3 in seconds', async () => {
    const seconds = await reader.read(mp3(100));
    expect(seconds).toBeCloseTo(100 * FRAME_SECONDS, 1);
  });
});
