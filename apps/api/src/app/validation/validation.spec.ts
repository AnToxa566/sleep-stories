import {
  Body,
  Controller,
  Get,
  HttpCode,
  INestApplication,
  Logger,
  Post,
  Put,
  StreamableFile,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  ApiErrorResponseSchema,
  CompleteOnboardingRequestSchema,
  MeResponseSchema,
} from '@sleep-stories/contracts';
import { createZodDto, ZodSerializerDto } from 'nestjs-zod';
import { UnvalidatedResponse } from './unvalidated-response.decorator';
import { ValidationModule } from './validation.module';

// A DTO class cannot extend a union type such as MeResponse, so responses declare the
// schema itself: ZodSerializerDto accepts either.
class CompleteOnboardingDto extends createZodDto(CompleteOnboardingRequestSchema) {}

const SENTINEL = 'sentinel-secret-value';

@Controller('test')
class TestController {
  @Put('onboarding')
  @ZodSerializerDto(MeResponseSchema)
  complete(@Body() body: CompleteOnboardingDto) {
    return { onboardingCompleted: true, preferences: body };
  }

  @Get('bad-response')
  @ZodSerializerDto(MeResponseSchema)
  badResponse() {
    // Not a valid MeResponse: a response bug that must never reach the client.
    return { onboardingCompleted: true, preferences: null, email: SENTINEL };
  }

  // No serializer and a non-empty body: the fail-closed interceptor must stop it.
  @Get('no-serializer')
  noSerializer() {
    return { onboardingCompleted: true, preferences: null, email: SENTINEL };
  }

  // The same body, explicitly marked as allowed.
  @Get('marked')
  @UnvalidatedResponse()
  marked() {
    return { message: 'marked' };
  }

  @Get('empty')
  @HttpCode(204)
  empty(): void {
    return undefined;
  }

  @Get('null')
  nullBody(): null {
    return null;
  }

  @Get('stream')
  stream(): StreamableFile {
    return new StreamableFile(Buffer.from('streamed'));
  }

  // Typed with a plain interface instead of a DTO: nothing would validate it.
  @Post('undeclared')
  undeclared(@Body() body: { value: string }) {
    return body;
  }
}

const VALID = { voiceSlug: 'anna', styles: ['facts'], interestSlugs: ['space'], customInterests: [] };

describe('request and response validation', () => {
  let app: INestApplication;
  let baseUrl: string;
  const errorLog = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ValidationModule],
      controllers: [TestController],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useLogger(false);
    await app.listen(0);
    baseUrl = await app.getUrl();
  });

  afterAll(async () => {
    await app.close();
    errorLog.mockRestore();
  });

  beforeEach(() => errorLog.mockClear());

  async function put(body: unknown) {
    const response = await fetch(`${baseUrl}/test/onboarding`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: response.status, text: await response.text() };
  }

  it('accepts a valid body and returns it parsed with the response schema', async () => {
    const { status, text } = await put(VALID);
    expect(status).toBe(200);
    expect(MeResponseSchema.parse(JSON.parse(text))).toEqual({ onboardingCompleted: true, preferences: VALID });
  });

  it.each([
    ['an extra key such as userId', { ...VALID, userId: SENTINEL }],
    ['a wrong type', { ...VALID, voiceSlug: { nested: SENTINEL } }],
    ['empty styles', { ...VALID, styles: [] }],
    ['duplicate styles', { ...VALID, styles: ['facts', 'facts'] }],
    ['a missing field', { styles: ['facts'], interestSlugs: ['space'] }],
    ['an unknown style carrying a value', { ...VALID, styles: [SENTINEL] }],
  ])('rejects %s with a validation_failed body that has no submitted value', async (_label, body) => {
    const { status, text } = await put(body);
    expect(status).toBe(400);
    const parsed = ApiErrorResponseSchema.parse(JSON.parse(text));
    expect(parsed).toMatchObject({ statusCode: 400, code: 'validation_failed' });
    expect(parsed.message).toContain('Request validation failed');
    expect(text).not.toContain(SENTINEL);
  });

  it('names the failing path and issue code', async () => {
    const { text } = await put({ ...VALID, styles: [] });
    expect(ApiErrorResponseSchema.parse(JSON.parse(text)).message).toContain('styles: too_small');
  });

  it('rejects a body that is not JSON-object shaped', async () => {
    const { status, text } = await put([SENTINEL]);
    expect(status).toBe(400);
    expect(ApiErrorResponseSchema.safeParse(JSON.parse(text)).success).toBe(true);
    expect(text).not.toContain(SENTINEL);
  });

  it('turns a response that violates its schema into a 500 without leaking the value, and logs paths only', async () => {
    const response = await fetch(`${baseUrl}/test/bad-response`);
    const text = await response.text();
    expect(response.status).toBe(500);
    expect(text).not.toContain(SENTINEL);
    expect(errorLog).toHaveBeenCalled();
    for (const call of errorLog.mock.calls) {
      expect(String(call[0])).not.toContain(SENTINEL);
    }
  });

  it('fails closed on a body that is not declared with a DTO, and logs the route but no value', async () => {
    const response = await fetch(`${baseUrl}/test/undeclared?q=${SENTINEL}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value: SENTINEL }),
    });
    const text = await response.text();
    expect(response.status).toBe(500);
    expect(text).not.toContain(SENTINEL);
    expect(JSON.parse(text)).toEqual({ statusCode: 500, message: 'Internal Server Error' });
    const logged = errorLog.mock.calls.map((call) => String(call[0]));
    expect(logged).toEqual(['A handler parameter is not declared with a contracts DTO (POST /test/undeclared)']);
  });

  describe('responses without a serializer (fail closed)', () => {
    it('lets a route with a serializer through, parsed with its schema', async () => {
      const { status, text } = await put(VALID);
      expect(status).toBe(200);
      expect(JSON.parse(text)).toEqual({ onboardingCompleted: true, preferences: VALID });
    });

    it('answers 500 for a non-empty body with no serializer, without the content, and logs names only', async () => {
      const response = await fetch(`${baseUrl}/test/no-serializer`);
      const text = await response.text();
      expect(response.status).toBe(500);
      expect(JSON.parse(text)).toEqual({ statusCode: 500, message: 'Internal Server Error' });
      expect(text).not.toContain(SENTINEL);
      const logged = errorLog.mock.calls.map((call) => String(call[0]));
      expect(logged).toEqual([expect.stringContaining('TestController.noSerializer')]);
      expect(logged.join('\n')).not.toContain(SENTINEL);
    });

    it('passes a route marked @UnvalidatedResponse() through unchanged', async () => {
      const response = await fetch(`${baseUrl}/test/marked`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ message: 'marked' });
      expect(errorLog).not.toHaveBeenCalled();
    });

    it('accepts an empty response (undefined on 204, and null)', async () => {
      const noContent = await fetch(`${baseUrl}/test/empty`);
      expect(noContent.status).toBe(204);
      expect(await noContent.text()).toBe('');
      const nothing = await fetch(`${baseUrl}/test/null`);
      expect(nothing.status).toBe(200);
      expect(await nothing.text()).toBe('');
      expect(errorLog).not.toHaveBeenCalled();
    });

    it('accepts a StreamableFile', async () => {
      const response = await fetch(`${baseUrl}/test/stream`);
      expect(response.status).toBe(200);
      expect(await response.text()).toBe('streamed');
    });
  });

  it('keeps Nest default behaviour for an unknown route', async () => {
    const response = await fetch(`${baseUrl}/test/nope`);
    expect(response.status).toBe(404);
  });
});
