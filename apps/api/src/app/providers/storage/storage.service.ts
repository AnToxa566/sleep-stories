import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Env } from '../../config/env';

// Thrown for every signing failure. The message is fixed on purpose: it never carries
// the storage URL, the key, the bucket or an object path, because Nest logs an
// unhandled error's message and the client sees only a generic 500 (SECURITY.md rule 1
// and 9). The cause (a storage error string) is dropped for the same reason.
export class StorageSigningError extends Error {
  constructor() {
    super('Storage signing failed');
    this.name = 'StorageSigningError';
  }
}

// The only place in the API that holds the Supabase service-role client (AGENTS.md
// architecture rule 2). The key bypasses RLS, so this class exposes narrow operations
// instead of the client. Add operations here (upload for story audio, later) rather
// than passing the client out.
@Injectable()
export class StorageService {
  private readonly client: SupabaseClient;
  private readonly bucket: string;
  // Local development only (see STORAGE_PUBLIC_URL in config/env.ts). The local Supabase
  // stack signs URLs with the host of SUPABASE_URL (127.0.0.1), which a phone cannot
  // reach. The token is bound to the object path, not the host, so swapping the origin
  // keeps the URL valid. Buys a playable sample on a real phone; costs a dev-only knob,
  // which validateEnv refuses in production and on Cloud Run.
  private readonly publicOrigin: URL | null;

  constructor(config: ConfigService<Env, true>) {
    this.bucket = config.get('AUDIO_BUCKET', { infer: true });
    const publicUrl = config.get('STORAGE_PUBLIC_URL', { infer: true });
    this.publicOrigin = publicUrl === undefined ? null : new URL(publicUrl);
    // A server client has no user session to keep or refresh.
    this.client = createClient(
      config.get('SUPABASE_URL', { infer: true }),
      config.get('SUPABASE_SERVICE_ROLE_KEY', { infer: true }),
      { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
    );
  }

  // Signs object paths (relative to the audio bucket) in ONE request and returns the
  // URLs in the same order as `paths`. Batching buys a fixed number of round trips for
  // a list (the voice step shows four rows); it costs that one bad path fails the whole
  // call, which is what we want: a partial catalogue with a dead play button is worse
  // than an error the app can retry. Any per-item error, a missing URL or a count that
  // does not match becomes a StorageSigningError.
  async signMany(paths: readonly string[], expiresInSeconds: number): Promise<string[]> {
    if (paths.length === 0) {
      return [];
    }
    const { data, error } = await this.client.storage
      .from(this.bucket)
      .createSignedUrls([...paths], expiresInSeconds);
    if (error !== null || data === null || data.length !== paths.length) {
      throw new StorageSigningError();
    }
    const urlByPath = new Map<string, string>();
    for (const item of data) {
      if (item.error !== null || item.path === null || item.signedUrl === null) {
        throw new StorageSigningError();
      }
      urlByPath.set(item.path, item.signedUrl);
    }
    return paths.map((path) => {
      const url = urlByPath.get(path);
      if (url === undefined) {
        throw new StorageSigningError();
      }
      return this.withPublicOrigin(url);
    });
  }

  // Replaces protocol, host and port, keeps path and query. A URL that does not parse
  // is a signing failure; the generic error carries no URL.
  private withPublicOrigin(signedUrl: string): string {
    if (this.publicOrigin === null) {
      return signedUrl;
    }
    if (!URL.canParse(signedUrl)) {
      throw new StorageSigningError();
    }
    const url = new URL(signedUrl);
    url.protocol = this.publicOrigin.protocol;
    url.hostname = this.publicOrigin.hostname;
    // Set explicitly: assigning a host without a port would keep the old port.
    url.port = this.publicOrigin.port;
    return url.toString();
  }
}
