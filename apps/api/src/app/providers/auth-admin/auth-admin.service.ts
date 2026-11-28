import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, isAuthApiError } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Env } from '../../platform/config/env';

// The SDK sets no timeout of its own. The account deletion holds a database transaction
// open while this call runs, so it must end well inside that transaction's timeout.
export const AUTH_ADMIN_TIMEOUT_MS = 10_000;

// Thrown for every failure of an auth admin call. The message is fixed on purpose and the
// cause is dropped: the SDK's error text can carry the URL or details of the person
// (SECURITY.md rules 1 and 9).
export class AuthAdminError extends Error {
  constructor() {
    super('Auth admin request failed');
    this.name = 'AuthAdminError';
  }
}

// With the storage service, one of the two places in the API that hold a Supabase
// service-role client (AGENTS.md architecture rule 2; `architecture.spec.ts` checks it).
// The key bypasses RLS and can manage every account, so this class exposes one narrow
// operation and never the client.
@Injectable()
export class AuthAdminService {
  private readonly client: SupabaseClient;

  constructor(config: ConfigService<Env, true>) {
    // A server client has no user session to keep or refresh.
    this.client = createClient(
      config.get('SUPABASE_URL', { infer: true }),
      config.get('SUPABASE_SERVICE_ROLE_KEY', { infer: true }),
      {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        global: {
          fetch: (input, init) =>
            fetch(input, { ...init, signal: AbortSignal.timeout(AUTH_ADMIN_TIMEOUT_MS) }),
        },
      },
    );
  }

  // Deletes the sign-in record of one person for good (a hard delete, the SDK's default).
  // IRREVERSIBLE. `userId` must come from the verified token, never from a request value.
  //
  // A user that is already gone counts as success, so a repeated deletion can finish. Both
  // the status and the code must say so: a bare 404 (a wrong SUPABASE_URL, a gateway with
  // no such route) is a failure, because treating it as success would erase the person's
  // data and leave their sign-in record alive.
  async deleteUser(userId: string): Promise<void> {
    let error: unknown;
    try {
      ({ error } = await this.client.auth.admin.deleteUser(userId));
    } catch {
      throw new AuthAdminError();
    }
    if (error === null) {
      return;
    }
    if (isAuthApiError(error) && error.status === 404 && error.code === 'user_not_found') {
      return;
    }
    throw new AuthAdminError();
  }
}
