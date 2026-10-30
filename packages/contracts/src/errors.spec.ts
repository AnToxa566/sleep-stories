import { ApiErrorResponseSchema } from './errors';

describe('ApiErrorResponseSchema', () => {
  it('parses an API error body', () => {
    const result = ApiErrorResponseSchema.safeParse({
      statusCode: 422,
      code: 'unknown_voice',
      message: 'Unknown voice',
    });
    expect(result.success).toBe(true);
  });

  it.each([401, 503, 400, 599])('accepts status code %i', (statusCode) => {
    expect(
      ApiErrorResponseSchema.safeParse({ statusCode, code: 'unauthorized', message: 'x' }).success,
    ).toBe(true);
  });

  it('accepts the job_retry code of the internal job endpoint', () => {
    expect(
      ApiErrorResponseSchema.safeParse({ statusCode: 503, code: 'job_retry', message: 'x' }).success,
    ).toBe(true);
  });

  it.each([399, 600, 200, 0])('rejects status code %i', (statusCode) => {
    expect(
      ApiErrorResponseSchema.safeParse({ statusCode, code: 'unauthorized', message: 'x' }).success,
    ).toBe(false);
  });

  it('rejects an unknown error code', () => {
    expect(
      ApiErrorResponseSchema.safeParse({ statusCode: 500, code: 'boom', message: 'x' }).success,
    ).toBe(false);
  });

  it('rejects a non-integer status code', () => {
    expect(
      ApiErrorResponseSchema.safeParse({ statusCode: 4.5, code: 'unauthorized', message: 'x' })
        .success,
    ).toBe(false);
  });

  it('rejects extra keys', () => {
    expect(
      ApiErrorResponseSchema.safeParse({
        statusCode: 401,
        code: 'unauthorized',
        message: 'x',
        stack: 'trace',
      }).success,
    ).toBe(false);
  });
});
