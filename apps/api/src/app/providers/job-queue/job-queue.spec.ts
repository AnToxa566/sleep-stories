import { NoopJobQueue } from './job-queue';

describe('NoopJobQueue', () => {
  it('resolves with undefined and does nothing', async () => {
    await expect(
      new NoopJobQueue().enqueue('00000000-0000-4000-8000-000000000000'),
    ).resolves.toBeUndefined();
  });
});
