import { Injectable } from '@nestjs/common';
import { parseBuffer } from 'music-metadata';

// The only file that imports music-metadata. It is ESM-only: webpack keeps it external
// and Node 24 require()s it, the same way as jose (see jest.config.cts for the tests).
// An injectable class so the renderer can be tested with a fake reader.
@Injectable()
export class AudioDurationReader {
  // The duration in seconds, or undefined when the container does not say. `duration: true`
  // makes the parser scan the frames when the header has no length (a CBR file without a
  // Xing tag), which costs a pass over the buffer (a few MB) and buys a real number.
  async read(audio: Buffer): Promise<number | undefined> {
    const metadata = await parseBuffer(audio, { mimeType: 'audio/mpeg' }, { duration: true });
    return metadata.format.duration;
  }
}
