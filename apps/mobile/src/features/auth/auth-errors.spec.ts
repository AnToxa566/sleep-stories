import { strings } from '../../strings';
import { authErrorMessage, classifyAuthError } from './auth-errors';

// Shapes copied from @supabase/auth-js: AuthApiError carries code + status, a network
// failure is AuthRetryableFetchError (status 0 or 5xx, no code).
const apiError = (code: string, status: number) => ({ name: 'AuthApiError', code, status, message: 'x' });

describe('classifyAuthError', () => {
  it.each([
    [apiError('email_exists', 422), 'userAlreadyExists'],
    [apiError('user_already_exists', 422), 'userAlreadyExists'],
    [apiError('invalid_credentials', 400), 'invalidCredentials'],
    [apiError('weak_password', 422), 'weakPassword'],
    [apiError('over_request_rate_limit', 429), 'rateLimited'],
    [apiError('over_email_send_rate_limit', 429), 'rateLimited'],
    [{ name: 'AuthApiError', status: 429, message: 'x' }, 'rateLimited'],
    [apiError('email_address_invalid', 400), 'emailInvalid'],
    [{ name: 'AuthRetryableFetchError', status: 0, message: 'x' }, 'network'],
    [{ name: 'AuthRetryableFetchError', status: 503, message: 'x' }, 'network'],
    [{ name: 'AbortError', message: 'x' }, 'network'],
    [{ name: 'TypeError', message: 'Network request failed' }, 'network'],
    [{ name: 'TypeError', message: 'Failed to fetch' }, 'network'],
    [apiError('something_new', 500), 'generic'],
    [{ name: 'Error', message: 'boom' }, 'generic'],
    [new Error('anything'), 'generic'],
    [null, 'generic'],
    [undefined, 'generic'],
    ['text', 'generic'],
  ])('classifies %j as %s', (error, kind) => {
    expect(classifyAuthError(error)).toBe(kind);
  });
});

describe('authErrorMessage', () => {
  it('returns Russian copy from strings.ts for every kind', () => {
    expect(authErrorMessage('invalidCredentials')).toBe(strings.auth.errors.invalidCredentials);
    expect(authErrorMessage('userAlreadyExists')).toBe(strings.auth.errors.userAlreadyExists);
    expect(authErrorMessage('network')).toBe(strings.auth.errors.network);
    expect(authErrorMessage('generic')).toBe(strings.auth.errors.generic);
  });

  it('never carries the server message or the email', () => {
    const secretish = {
      name: 'AuthApiError',
      code: 'invalid_credentials',
      status: 400,
      message: 'secret.person@example.com wrong password hunter2',
    };
    const text = authErrorMessage(classifyAuthError(secretish));
    expect(text).not.toContain('example.com');
    expect(text).not.toContain('hunter2');
  });
});
