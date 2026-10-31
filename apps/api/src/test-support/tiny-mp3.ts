// A tiny MP3 built from bytes, for tests that need audio a real parser accepts: MPEG-1
// Layer III, 128 kbps, 44.1 kHz, no padding, stereo. Each frame is 417 bytes and lasts
// 1152 / 44100 s. The frame payload is zeros (silence-like data); the parser only walks the
// headers.
const FRAME_HEADER = [0xff, 0xfb, 0x90, 0x00];
export const TINY_MP3_FRAME_BYTES = 417;
export const TINY_MP3_FRAME_SECONDS = 1152 / 44100;

export function tinyMp3(frames: number): Buffer {
  const frame = Buffer.alloc(TINY_MP3_FRAME_BYTES);
  Buffer.from(FRAME_HEADER).copy(frame);
  return Buffer.concat(Array.from({ length: frames }, () => frame));
}
