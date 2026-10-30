import { Controller, Get, HttpCode, INestApplication, Logger, Module, Post, SetMetadata } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ApiErrorResponseSchema } from '@sleep-stories/contracts';
import { IS_INTERNAL_KEY } from '../auth/internal-route.key';
import { AccessTokenVerifier, TokenRejectedError, VerifiedAccessToken } from '../auth/access-token-verifier';
import { CurrentUserId } from '../auth/current-user-id.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { assertInternalRoutesAreGuarded, listInternalRoutes } from '../../test-support/internal-routes';
import { UnvalidatedResponse } from '../validation/unvalidated-response.decorator';
import {
  InternalCredentialRejectedError,
  InternalCredentialVerifier,
  createInternalCredentialVerifier,
} from './internal-credential.verifier';
import { LocalDispatchSecret } from '../providers/job-queue/local-dispatch-secret';
import { InternalRoute } from './internal-route.decorator';

const USER_ID = '3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f';
const USER_TOKEN = 'user-token';
const INTERNAL_TOKEN = 'internal-token';

class FakeUserVerifier extends AccessTokenVerifier {
  async verify(token: string): Promise<VerifiedAccessToken> {
    if (token === USER_TOKEN) {
      return { userId: USER_ID };
    }
    throw new TokenRejectedError('JWSInvalid');
  }
}

class FakeInternalVerifier extends InternalCredentialVerifier {
  async verify(token: string): Promise<void> {
    if (token !== INTERNAL_TOKEN) {
      throw new InternalCredentialRejectedError('SecretMismatch');
    }
  }
}

@Controller('internal/stub')
@InternalRoute()
@UnvalidatedResponse()
class InternalStubController {
  @Post()
  @HttpCode(200)
  run() {
    return { ran: true };
  }
}

// An /internal/* controller WITHOUT the decorator: the mistake the enumeration catches.
@Controller('internal/plain')
@UnvalidatedResponse()
class PlainInternalController {
  @Post()
  run() {
    return { ran: true };
  }
}

// The dangerous case: the mark without the guard, on a path that is NOT under `internal`,
// so only the guard-presence rule of the helper can see it.
@Controller('sneaky')
@UnvalidatedResponse()
class MarkedWithoutGuardController {
  @SetMetadata(IS_INTERNAL_KEY, true)
  @Post()
  @HttpCode(200)
  run() {
    return { ran: true };
  }
}

// A base class with a marked handler and no guard: seen through the prototype chain.
class BaseWithMarkedHandler {
  @SetMetadata(IS_INTERNAL_KEY, true)
  @Post()
  inherited() {
    return { ran: true };
  }
}

@Controller('derived')
@UnvalidatedResponse()
class DerivedController extends BaseWithMarkedHandler {}

@Controller('normal')
@UnvalidatedResponse()
class NormalController {
  @Get()
  index(@CurrentUserId() userId: string) {
    return { userId };
  }
}

@Module({
  providers: [
    { provide: AccessTokenVerifier, useClass: FakeUserVerifier },
    { provide: InternalCredentialVerifier, useClass: FakeInternalVerifier },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
  controllers: [InternalStubController, NormalController],
})
class DecoratedOnlyModule {}

@Module({
  providers: [
    { provide: AccessTokenVerifier, useClass: FakeUserVerifier },
    { provide: InternalCredentialVerifier, useClass: FakeInternalVerifier },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
  controllers: [InternalStubController, PlainInternalController, NormalController],
})
class WithUndecoratedModule {}

async function start(module: new () => object): Promise<{ app: INestApplication; baseUrl: string }> {
  const moduleRef = await Test.createTestingModule({ imports: [module] }).compile();
  const app = moduleRef.createNestApplication();
  app.useLogger(false);
  await app.listen(0);
  return { app, baseUrl: await app.getUrl() };
}

describe('/internal/* authentication (stub controllers, global JwtAuthGuard)', () => {
  let app: INestApplication;
  let baseUrl: string;
  const spies = (['log', 'error', 'warn', 'debug', 'verbose', 'fatal'] as const).map((level) =>
    jest.spyOn(Logger.prototype, level).mockImplementation(() => undefined),
  );

  beforeAll(async () => {
    ({ app, baseUrl } = await start(DecoratedOnlyModule));
  });

  afterAll(async () => {
    await app.close();
    spies.forEach((spy) => spy.mockRestore());
  });

  async function call(method: string, path: string, authorization?: string) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: authorization === undefined ? {} : { authorization },
    });
    return { status: response.status, text: await response.text() };
  }

  it('answers 401 without a token', async () => {
    const { status, text } = await call('POST', '/internal/stub');
    expect(status).toBe(401);
    expect(ApiErrorResponseSchema.parse(JSON.parse(text))).toMatchObject({ statusCode: 401, code: 'unauthorized' });
  });

  it('answers 401 for a valid user token on an internal route', async () => {
    expect((await call('POST', '/internal/stub', `Bearer ${USER_TOKEN}`)).status).toBe(401);
  });

  it('answers 200 for the internal credential', async () => {
    const { status, text } = await call('POST', '/internal/stub', `Bearer ${INTERNAL_TOKEN}`);
    expect(status).toBe(200);
    expect(JSON.parse(text)).toEqual({ ran: true });
  });

  it('answers 401 for the internal credential on a normal user route', async () => {
    expect((await call('GET', '/normal', `Bearer ${INTERNAL_TOKEN}`)).status).toBe(401);
    expect((await call('GET', '/normal', `Bearer ${USER_TOKEN}`)).status).toBe(200);
  });

  it('finds the decorated route and accepts the module', () => {
    const routes = assertInternalRoutesAreGuarded(app);
    expect(routes).toEqual([
      expect.objectContaining({ controller: 'InternalStubController', handler: 'run', path: 'internal/stub', isInternal: true }),
    ]);
    expect(listInternalRoutes(app).map((route) => route.path).sort()).toEqual(['internal/stub', 'normal']);
  });
});

describe('/internal/* in the real credential modes (stub controller)', () => {
  const secret = new LocalDispatchSecret();

  async function run(mode: 'none' | 'local' | 'cloud-tasks') {
    @Module({
      providers: [
        { provide: AccessTokenVerifier, useClass: FakeUserVerifier },
        {
          provide: InternalCredentialVerifier,
          useFactory: () =>
            createInternalCredentialVerifier({
              mode,
              audience: mode === 'local' ? undefined : 'https://example.invalid',
              serviceAccountEmail: mode === 'local' ? undefined : 'tasks@example.invalid',
              keys: (async () => {
                throw new Error('no network in this test');
              }) as never,
              secret,
            }),
        },
        { provide: APP_GUARD, useClass: JwtAuthGuard },
      ],
      controllers: [InternalStubController],
    })
    class ModeModule {}
    return start(ModeModule);
  }

  it.each([
    ['local', 200],
    ['none', 401],
    ['cloud-tasks', 401],
  ] as const)("the local secret on an internal route in '%s' mode answers %i", async (mode, expected) => {
    const spy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { app, baseUrl } = await run(mode);
    try {
      const response = await fetch(`${baseUrl}/internal/stub`, {
        method: 'POST',
        headers: { authorization: `Bearer ${secret.value}` },
      });
      expect(response.status).toBe(expected);
    } finally {
      await app.close();
      spy.mockRestore();
    }
  });
});

@Module({
  providers: [
    { provide: AccessTokenVerifier, useClass: FakeUserVerifier },
    { provide: InternalCredentialVerifier, useClass: FakeInternalVerifier },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
  controllers: [InternalStubController, MarkedWithoutGuardController],
})
class MarkedWithoutGuardModule {}

@Module({
  providers: [
    { provide: AccessTokenVerifier, useClass: FakeUserVerifier },
    { provide: InternalCredentialVerifier, useClass: FakeInternalVerifier },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
  controllers: [DerivedController],
})
class InheritedMarkModule {}

describe('assertInternalRoutesAreGuarded', () => {
  it('throws for a route that carries the mark without InternalAuthGuard, wherever its path is', async () => {
    const { app, baseUrl } = await start(MarkedWithoutGuardModule);
    try {
      expect(() => assertInternalRoutesAreGuarded(app)).toThrow(
        /marked as internal without InternalAuthGuard: MarkedWithoutGuardController\.run \(\/sneaky\)/,
      );
      // And at runtime the user guard does not step aside for it.
      const response = await fetch(`${baseUrl}/sneaky`, {
        method: 'POST',
        headers: { authorization: 'Bearer garbage' },
      });
      expect(response.status).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('sees a marked handler inherited from a base class', async () => {
    const { app } = await start(InheritedMarkModule);
    try {
      expect(listInternalRoutes(app)).toEqual([
        expect.objectContaining({ controller: 'DerivedController', handler: 'inherited', isInternal: true, hasInternalGuard: false }),
      ]);
      expect(() => assertInternalRoutesAreGuarded(app)).toThrow(/DerivedController\.inherited/);
    } finally {
      await app.close();
    }
  });

  it('throws, naming the route, for an /internal/* controller without @InternalRoute()', async () => {
    const { app } = await start(WithUndecoratedModule);
    try {
      expect(() => assertInternalRoutesAreGuarded(app)).toThrow(/PlainInternalController\.run \(\/internal\/plain\)/);
      expect(() => assertInternalRoutesAreGuarded(app)).not.toThrow(/InternalStubController/);
    } finally {
      await app.close();
    }
  });
});
