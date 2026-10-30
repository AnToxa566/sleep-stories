import { strings } from '../../strings';

// Maps a Supabase Auth failure to a kind, and a kind to Russian copy. The raw server
// message is never read into the result and never logged: it can quote the email or other
// request data. Only `code`, `status` and `name` are looked at.

export type AuthErrorKind =
  | 'userAlreadyExists'
  | 'invalidCredentials'
  | 'weakPassword'
  | 'rateLimited'
  | 'emailInvalid'
  | 'network'
  | 'generic';

// The fields of a Supabase `AuthError` (or of a thrown transport error) this module reads.
type ErrorLike = {
  code?: unknown;
  status?: unknown;
  name?: unknown;
  message?: unknown;
};

// GoTrue reports an existing email as `email_exists` (current servers) or
// `user_already_exists` (older servers and phone sign-ups); both mean the same to the user.
const ALREADY_EXISTS_CODES = new Set(['email_exists', 'user_already_exists']);
const RATE_LIMIT_CODES = new Set([
  'over_request_rate_limit',
  'over_email_send_rate_limit',
  'over_sms_send_rate_limit',
]);
const NETWORK_ERROR_NAMES = new Set(['AuthRetryableFetchError', 'AbortError']);
// React Native's fetch fails with a TypeError whose message is one of these. The message
// is only matched, never shown or stored.
const NETWORK_MESSAGE = /network request failed|failed to fetch|network error|timed? ?out/i;

export function classifyAuthError(error: unknown): AuthErrorKind {
  if (typeof error !== 'object' || error === null) return 'generic';
  const { code, status, name, message } = error as ErrorLike;

  if (typeof code === 'string') {
    if (ALREADY_EXISTS_CODES.has(code)) return 'userAlreadyExists';
    if (code === 'invalid_credentials') return 'invalidCredentials';
    if (code === 'weak_password') return 'weakPassword';
    if (RATE_LIMIT_CODES.has(code)) return 'rateLimited';
    if (code === 'email_address_invalid') return 'emailInvalid';
  }
  if (status === 429) return 'rateLimited';

  if (typeof name === 'string' && NETWORK_ERROR_NAMES.has(name)) return 'network';
  if (typeof status === 'number' && (status === 0 || (status >= 502 && status <= 504))) {
    return 'network';
  }
  if (name === 'TypeError' && typeof message === 'string' && NETWORK_MESSAGE.test(message)) {
    return 'network';
  }
  return 'generic';
}

const MESSAGES: Record<AuthErrorKind, string> = {
  userAlreadyExists: strings.auth.errors.userAlreadyExists,
  invalidCredentials: strings.auth.errors.invalidCredentials,
  weakPassword: strings.auth.errors.weakPassword,
  rateLimited: strings.auth.errors.rateLimited,
  emailInvalid: strings.auth.errors.emailInvalid,
  network: strings.auth.errors.network,
  generic: strings.auth.errors.generic,
};

export function authErrorMessage(kind: AuthErrorKind): string {
  return MESSAGES[kind];
}
