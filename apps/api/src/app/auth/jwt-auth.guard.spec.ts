import { Body, Controller, Get, INestApplication, Logger, Put, SetMetadata, UseGuards } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { ApiErrorResponseSchema, CompleteOnboardingRequestSchema } from '@sleep-stories/contracts';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { createZodDto } from 'nestjs-zod';
import { UnvalidatedResponse } from '../validation/unvalidated-response.decorator';
import { ValidationModule } from '../validation/validation.module';
import {
  AccessTokenVerifier,
  AuthUnavailableError,
  JoseAccessTokenVerifier,
  TokenRejectedError,
  VerifiedAccessToken,
} from './access-token-verifier';
import { AuthModule } from './auth.module';
import { CurrentUserId } from './current-user-id.decorator';
import { INTERNAL_GUARD_MARKER, IS_INTERNAL_KEY } from './internal-route.key';
import { Public } from './public.decorator';

const USER_ID = '3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f';
// Distinctive tokens so that a leak into a log or a response is easy to spot.
const GOOD = 'sentinel-token-good';
const BAD = 'sentinel-token-bad';
const DOWN = 'sentinel-token-down';
const BOOM = 'sentinel-token-boom';

class OnboardingBodyDto extends createZodDto(CompleteOnboardingRequestSchema) {}

class StubVerifier extends AccessTokenVerifier {
  readonly calls: string[] = [];

  async verify(token: string): Promise<VerifiedAccessToken> {
    this.calls.push(token);
    switch (token) {
      case GOOD:
        return { userId: USER_ID };
      case BAD:
        throw new TokenRejectedError('JWTExpired');
      case DOWN:
        throw new AuthUnavailableError('JWKSTimeout, ERR_JWKS_TIMEOUT');
      default:
        // Not a token fault and not an AuthUnavailableError either: must still deny.
        throw new Error(`unexpected failure for ${token}`);
    }
  }
}

// The routes below return plain objects only to exercise the guard; they opt out of
// response validation with @UnvalidatedResponse().
@Controller('guarded')
@UnvalidatedResponse()
class GuardedController {
  @Get('private')
  privateRoute(@CurrentUserId() userId: string) {
    return { userId };
  }

  // Does not read the user id: only the guard can stop a request to this route.
  @Get('bare')
  bareRoute() {
    return { ok: true };
  }

  // A route with a validated body: used to show the guard runs before the pipe.
  @Put('with-body')
  withBody(@Body() body: OnboardingBodyDto) {
    return { received: body.voiceSlug };
  }

  @Public()
  @Get('open')
  openRoute() {
    return { open: true };
  }

  // A @Public() route that asks for the user id: nobody authenticated it.
  @Public()
  @Get('open-with-user')
  openWithUser(@CurrentUserId() userId: string) {
    return { userId };
  }
}

// Stand-ins for the two halves of @InternalRoute(): the mark (IS_INTERNAL_KEY) and a guard
// that carries the marker of the real InternalAuthGuard. The real decorator and guard are
// tested in internal/internal-auth.http.spec.ts. The user guard may step aside only when
// both are present.
class StubInternalGuard {
  static readonly [INTERNAL_GUARD_MARKER] = true;
  canActivate(): boolean {
    return true;
  }
}

// Looks like a guard but is not the internal one.
class OtherGuard {
  canActivate(): boolean {
    return true;
  }
}

@Controller('marked')
@UnvalidatedResponse()
class InternalMarkedController {
  @SetMetadata(IS_INTERNAL_KEY, true)
  @UseGuards(StubInternalGuard)
  @Get('method')
  markedMethod() {
    return { marked: true };
  }

  // A marked route is not public for other purposes: nothing set a user id.
  @SetMetadata(IS_INTERNAL_KEY, true)
  @UseGuards(StubInternalGuard)
  @Get('with-user')
  markedWithUser(@CurrentUserId() userId: string) {
    return { userId };
  }

  // The dangerous case: the mark without the internal guard. The user guard must NOT
  // step aside here.
  @SetMetadata(IS_INTERNAL_KEY, true)
  @Get('mark-only')
  markOnly() {
    return { open: true };
  }

  // The mark with some other guard is the same case.
  @SetMetadata(IS_INTERNAL_KEY, true)
  @UseGuards(OtherGuard)
  @Get('other-guard')
  markedWithOtherGuard() {
    return { open: true };
  }

  @Get('unmarked')
  unmarked() {
    return { marked: false };
  }
}

// Mark and guard both at class level.
@SetMetadata(IS_INTERNAL_KEY, true)
@UseGuards(StubInternalGuard)
@UnvalidatedResponse()
@Controller('marked-class')
class InternalMarkedClassController {
  @Get()
  index() {
    return { marked: true };
  }
}

// @Public() on the class covers every route in it.
@Public()
@UnvalidatedResponse()
@Controller('open-class')
class OpenClassController {
  @Get()
  index() {
    return { open: true };
  }
}

describe('JwtAuthGuard (registered globally by AuthModule)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let verifier: StubVerifier;
  const spies = (['log', 'error', 'warn', 'debug', 'verbose', 'fatal'] as const).map((level) =>
    jest.spyOn(Logger.prototype, level).mockImplementation(() => undefined),
  );

  beforeAll(async () => {
    verifier = new StubVerifier();
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          ignoreEnvFile: true,
          ignoreEnvVars: true,
          load: [() => ({ SUPABASE_URL: 'http://127.0.0.1:54321' })],
        }),
        AuthModule,
        ValidationModule,
      ],
      controllers: [GuardedController, OpenClassController, InternalMarkedController, InternalMarkedClassController],
    })
      .overrideProvider(AccessTokenVerifier)
      .useValue(verifier)
      .compile();
    app = moduleRef.createNestApplication();
    app.useLogger(false);
    await app.listen(0);
    baseUrl = await app.getUrl();
  });

  afterAll(async () => {
    await app.close();
    spies.forEach((spy) => spy.mockRestore());
  });

  beforeEach(() => {
    verifier.calls.length = 0;
    spies.forEach((spy) => spy.mockClear());
  });

  async function get(path: string, authorization?: string, method = 'GET') {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: authorization === undefined ? {} : { authorization },
    });
    return { status: response.status, text: await response.text() };
  }

  async function putJson(path: string, body: unknown, authorization?: string) {
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        ...(authorization === undefined ? {} : { authorization }),
      },
      body: JSON.stringify(body),
    });
    return { status: response.status, text: await response.text() };
  }

  function expectErrorBody(text: string, statusCode: number, code: string) {
    expect(ApiErrorResponseSchema.parse(JSON.parse(text))).toEqual({
      statusCode,
      code,
      message: expect.any(String),
    });
  }

  it('lets a valid token through and hands the verified user id to the handler', async () => {
    const { status, text } = await get('/guarded/private', `Bearer ${GOOD}`);
    expect(status).toBe(200);
    expect(JSON.parse(text)).toEqual({ userId: USER_ID });
    expect(verifier.calls).toEqual([GOOD]);
  });

  it('accepts the scheme in any letter case', async () => {
    expect((await get('/guarded/private', `bearer ${GOOD}`)).status).toBe(200);
    expect((await get('/guarded/private', `BEARER ${GOOD}`)).status).toBe(200);
  });

  it.each([
    ['no Authorization header', undefined],
    ['the Basic scheme', 'Basic dXNlcjpwYXNz'],
    ['an empty header', ''],
    ['the scheme alone', 'Bearer'],
    ['an empty bearer token', 'Bearer '],
    ['two spaces before the token', `Bearer  ${GOOD}`],
    ['a token followed by more text', `Bearer ${GOOD} extra`],
    ['a tab instead of a space', `Bearer\t${GOOD}`],
    ['no scheme', GOOD],
    ['an oversized token', `Bearer ${'a'.repeat(9000)}`],
  ])('answers 401 unauthorized for %s, without calling the verifier', async (_label, header) => {
    const { status, text } = await get('/guarded/bare', header);
    expect(status).toBe(401);
    expectErrorBody(text, 401, 'unauthorized');
    expect(verifier.calls).toEqual([]);
  });

  it('skips the guard on a @Public() route, with or without a token', async () => {
    expect(await get('/guarded/open')).toMatchObject({ status: 200 });
    expect(await get('/guarded/open', 'Bearer garbage')).toMatchObject({ status: 200 });
    expect(verifier.calls).toEqual([]);
  });

  it('skips the guard on every route of a controller marked @Public() at class level', async () => {
    expect(await get('/open-class')).toMatchObject({ status: 200 });
    expect(await get('/open-class', 'Bearer garbage')).toMatchObject({ status: 200 });
    expect(verifier.calls).toEqual([]);
  });

  it('runs the guard for HEAD on a guarded route and skips it for HEAD on a public route (Nest routes HEAD to the GET handler)', async () => {
    const guarded = await get('/guarded/bare', undefined, 'HEAD');
    expect(guarded.status).toBe(401);
    const open = await get('/guarded/open', undefined, 'HEAD');
    expect(open.status).toBe(200);
    expect(open.text).toBe('');
    const openClass = await get('/open-class', undefined, 'HEAD');
    expect(openClass.status).toBe(200);
    expect(verifier.calls).toEqual([]);
  });

  it('runs the guard before the validation pipe: an unauthenticated invalid body gets 401, not 400', async () => {
    const invalid = { voiceSlug: 'sentinel-body-value', unexpected: 'sentinel-body-value' };
    for (const authorization of [undefined, `Bearer ${BAD}`]) {
      const { status, text } = await putJson('/guarded/with-body', invalid, authorization);
      expect(status).toBe(401);
      expectErrorBody(text, 401, 'unauthorized');
      expect(text).not.toContain('validation');
      expect(text).not.toContain('sentinel-body-value');
    }
    // With a valid token the same body does reach the pipe: the route is validated.
    const authenticated = await putJson('/guarded/with-body', invalid, `Bearer ${GOOD}`);
    expect(authenticated.status).toBe(400);
    expectErrorBody(authenticated.text, 400, 'validation_failed');
  });

  it('steps aside for a route marked internal, with or without a token', async () => {
    expect(await get('/marked/method')).toMatchObject({ status: 200 });
    expect(await get('/marked/method', 'Bearer garbage')).toMatchObject({ status: 200 });
    expect(verifier.calls).toEqual([]);
  });

  it('steps aside for a route with the mark and the internal guard at class level', async () => {
    expect(await get('/marked-class', 'Bearer garbage')).toMatchObject({ status: 200 });
    expect(verifier.calls).toEqual([]);
  });

  it('does NOT step aside for the mark without the internal guard: the user guard answers 401', async () => {
    for (const path of ['/marked/mark-only', '/marked/other-guard']) {
      expect((await get(path)).status).toBe(401);
      expect((await get(path, `Bearer ${BAD}`)).status).toBe(401);
    }
    // It is a user route then: a valid user token passes.
    expect((await get('/marked/mark-only', `Bearer ${GOOD}`)).status).toBe(200);
  });

  it('still requires a valid token on an unmarked route next to a marked one', async () => {
    expect((await get('/marked/unmarked')).status).toBe(401);
    expect((await get('/marked/unmarked', `Bearer ${BAD}`)).status).toBe(401);
    expect((await get('/marked/unmarked', `Bearer ${GOOD}`)).status).toBe(200);
  });

  it('does not treat a marked route as public: a handler asking for the user id still gets 401', async () => {
    const { status, text } = await get('/marked/with-user');
    expect(status).toBe(401);
    expectErrorBody(text, 401, 'unauthorized');
    expect(verifier.calls).toEqual([]);
  });

  it('fails closed when a handler asks for the user id on a @Public() route', async () => {
    const { status, text } = await get('/guarded/open-with-user');
    expect(status).toBe(401);
    expectErrorBody(text, 401, 'unauthorized');
  });

  it('answers 401 when the verifier says the token is bad', async () => {
    const { status, text } = await get('/guarded/bare', `Bearer ${BAD}`);
    expect(status).toBe(401);
    expectErrorBody(text, 401, 'unauthorized');
  });

  it('answers 503 auth_unavailable when the keys cannot be reached', async () => {
    const { status, text } = await get('/guarded/bare', `Bearer ${DOWN}`);
    expect(status).toBe(503);
    expectErrorBody(text, 503, 'auth_unavailable');
  });

  it('denies with 503, not a pass, on an error nobody anticipated', async () => {
    const { status, text } = await get('/guarded/bare', `Bearer ${BOOM}`);
    expect(status).toBe(503);
    expectErrorBody(text, 503, 'auth_unavailable');
  });

  it('keeps Nest default behaviour for an unknown route (guards only run on matched routes)', async () => {
    expect((await get('/nope')).status).toBe(404);
  });

  it('logs only outcome classes, never the token, the user id or an error message', async () => {
    for (const token of [GOOD, BAD, DOWN, BOOM]) {
      await get('/guarded/private', `Bearer ${token}`);
    }
    const logged = spies.flatMap((spy) => spy.mock.calls).map((call) => JSON.stringify(call));
    expect(logged.length).toBeGreaterThan(0);
    for (const line of logged) {
      expect(line).not.toContain('sentinel-token');
      expect(line).not.toContain(USER_ID);
      expect(line).not.toContain('unexpected failure');
    }
    expect(logged.join('\n')).toContain('JWTExpired');
    expect(logged.join('\n')).toContain('ERR_JWKS_TIMEOUT');
  });
});

// The guard with the real jose verifier: what an operator sees in the log when a
// token is rejected, and that it never carries a value from the token.
describe('JwtAuthGuard log line for a rejected token (real verifier)', () => {
  const ISSUER = 'http://127.0.0.1:54321/auth/v1';
  const DISTINCTIVE_ISSUER = 'https://sentinel-issuer-value.example/auth/v1';
  let app: INestApplication;
  let baseUrl: string;
  let token: string;
  let warn: jest.SpyInstance;

  beforeAll(async () => {
    // Created here, not at collection time: the suite above restores its own spies in
    // its afterAll, which would also remove one created earlier on the same method.
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const pair = await generateKeyPair('ES256', { extractable: true });
    const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'ES256', use: 'sig' };
    token = await new SignJWT({ sub: USER_ID, email: 'sentinel-email@example.com' })
      .setProtectedHeader({ alg: 'ES256', kid: 'k1' })
      .setIssuer(DISTINCTIVE_ISSUER)
      .setAudience('authenticated')
      .setExpirationTime('10m')
      .sign(pair.privateKey);
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          ignoreEnvFile: true,
          ignoreEnvVars: true,
          load: [() => ({ SUPABASE_URL: 'http://127.0.0.1:54321' })],
        }),
        AuthModule,
        ValidationModule,
      ],
      controllers: [GuardedController],
    })
      .overrideProvider(AccessTokenVerifier)
      .useValue(new JoseAccessTokenVerifier({ keys: createLocalJWKSet({ keys: [jwk] }), issuer: ISSUER }))
      .compile();
    app = moduleRef.createNestApplication();
    app.useLogger(false);
    await app.listen(0);
    baseUrl = await app.getUrl();
  });

  afterAll(async () => {
    await app.close();
    warn.mockRestore();
  });

  it('logs the failing claim and kind but no claim value and no part of the token', async () => {
    const response = await fetch(`${baseUrl}/guarded/bare`, { headers: { authorization: `Bearer ${token}` } });
    expect(response.status).toBe(401);
    const logged = warn.mock.calls.map((call) => String(call[0]));
    expect(logged).toEqual(['Access token rejected (JWTClaimValidationFailed (iss: check_failed))']);
    for (const secret of [DISTINCTIVE_ISSUER, 'sentinel-issuer-value', 'sentinel-email', USER_ID, ...token.split('.')]) {
      expect(logged.join('\n')).not.toContain(secret);
    }
  });
});
