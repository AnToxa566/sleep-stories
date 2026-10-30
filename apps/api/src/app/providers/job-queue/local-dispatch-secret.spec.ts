import { format, inspect } from 'node:util';
import type { HttpAdapterHost } from '@nestjs/core';
import { LocalDispatchSecret } from './local-dispatch-secret';
import { LocalJobQueue } from './local-job-queue';

describe('LocalDispatchSecret', () => {
  it('is random per instance and 64 hex characters long', () => {
    const first = new LocalDispatchSecret();
    const second = new LocalDispatchSecret();
    expect(first.value).toMatch(/^[0-9a-f]{64}$/);
    expect(first.value).not.toBe(second.value);
  });

  // The verifier that holds the instance is checked in
  // internal/internal-credential.verifier.spec.ts (providers/ must not import internal/).
  it('does not reveal the secret when logged, inspected or serialised, alone or in a holder', () => {
    const secret = new LocalDispatchSecret();
    const printed = [
      JSON.stringify(secret),
      JSON.stringify({ nested: secret }),
      String(secret),
      `${secret}`,
      inspect(secret, { depth: 10, showHidden: true }),
      inspect({ holder: secret }, { depth: 10, showHidden: true }),
      // The local queue holds the instance; this is what a log of the queue would show.
      inspect(new LocalJobQueue(secret, {} as HttpAdapterHost), { depth: 10, showHidden: true }),
      format('%o %O %j %s', secret, secret, secret, secret),
    ].join(' ');
    expect(printed).not.toContain(secret.value);
    expect(printed).toContain('[LocalDispatchSecret]');
  });
});
