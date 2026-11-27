import { ApiErrorResponseSchema, type ApiErrorCode } from '@sleep-stories/contracts';
import type { z } from 'zod';

// A pure HTTP client for our own API: no Expo or Supabase imports, so it runs under Jest
// with a fake fetch. The real instance is wired in api-fetch.ts.

// The server answered with an error that is not "unavailable" and not 401.
export class ApiError extends Error {
  readonly status: number;
  // The code from the server's error body, or null when the body is not our error shape.
  readonly code: ApiErrorCode | null;

  constructor(status: number, code: ApiErrorCode | null) {
    // Fixed text on purpose: nothing from the request (token, URL query) or from the
    // response body goes into an error message that might be logged.
    super(code ? `API request failed with status ${status} (${code})` : `API request failed with status ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

// The server could not be reached or answered 502/503/504, or the request timed out.
// Never a reason to sign the user out.
export class ApiUnavailableError extends Error {
  constructor(reason: 'network' | 'timeout' | 'server') {
    super(`API unavailable (${reason})`);
    this.name = 'ApiUnavailableError';
  }
}

// The server answered 2xx but the body did not match the contract schema.
export class ApiContractError extends Error {
  constructor() {
    super('API response did not match the expected schema');
    this.name = 'ApiContractError';
  }
}

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export type ApiClientOptions = {
  // Without a trailing slash, including the /api prefix.
  baseUrl: string;
  // Called per request, so a refreshed token is always the one sent.
  getAccessToken: () => Promise<string | null>;
  // Called on a 401 (or when there is no token at all). Local sign-out only.
  onUnauthorized: () => void | Promise<void>;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
};

export type ApiRequest<TResponse, TBody = never> = {
  method: 'GET' | 'PUT' | 'POST' | 'DELETE';
  // Starts with "/", for example "/me".
  path: string;
  // Both schemas come from packages/contracts: the body is validated before it is sent.
  body?: { schema: z.ZodType<TBody>; value: TBody };
  responseSchema: z.ZodType<TResponse>;
};

const DEFAULT_TIMEOUT_MS = 15_000;
const UNAVAILABLE_STATUSES = new Set([502, 503, 504]);

export function createApiClient(options: ApiClientOptions) {
  const fetchImpl: FetchLike = options.fetchImpl ?? ((input, init) => fetch(input, init));
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function handleUnauthorized(): Promise<void> {
    try {
      await options.onUnauthorized();
    } catch {
      // A failing sign-out must not hide the 401 from the caller.
    }
  }

  return async function apiFetch<TResponse, TBody = never>(
    request: ApiRequest<TResponse, TBody>,
  ): Promise<TResponse> {
    let token: string | null;
    try {
      token = await options.getAccessToken();
    } catch {
      throw new ApiUnavailableError('network');
    }
    if (token === null) {
      await handleUnauthorized();
      throw new ApiError(401, 'unauthorized');
    }

    const headers: Record<string, string> = {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    };
    let serializedBody: string | undefined;
    if (request.body) {
      headers['Content-Type'] = 'application/json';
      serializedBody = JSON.stringify(request.body.schema.parse(request.body.value));
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    let payload: unknown;
    try {
      try {
        response = await fetchImpl(`${options.baseUrl}${request.path}`, {
          method: request.method,
          headers,
          body: serializedBody,
          signal: controller.signal,
        });
        payload = await readJson(response);
      } catch {
        // Whatever the transport threw is replaced by a fixed error: its message could quote the request.
        throw new ApiUnavailableError(controller.signal.aborted ? 'timeout' : 'network');
      }
    } finally {
      clearTimeout(timer);
    }

    if (response.status === 401) {
      await handleUnauthorized();
      throw new ApiError(401, errorCode(payload) ?? 'unauthorized');
    }
    if (UNAVAILABLE_STATUSES.has(response.status)) {
      throw new ApiUnavailableError('server');
    }
    if (!response.ok) {
      // Nest's own 404/500 and body-parser errors carry no `code`: still a generic ApiError.
      throw new ApiError(response.status, errorCode(payload));
    }

    const parsed = request.responseSchema.safeParse(payload);
    if (!parsed.success) throw new ApiContractError();
    return parsed.data;
  };
}

export type ApiFetch = ReturnType<typeof createApiClient>;

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function errorCode(payload: unknown): ApiErrorCode | null {
  const parsed = ApiErrorResponseSchema.safeParse(payload);
  return parsed.success ? parsed.data.code : null;
}
