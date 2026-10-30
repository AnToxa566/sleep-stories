import { env } from '../config/env';
import { supabase } from '../features/auth/supabase';
import { createApiClient } from './api-client';

// The app's one API client: the bearer token is read from the Supabase session per request.
export const apiFetch = createApiClient({
  baseUrl: env.apiUrl,
  getAccessToken: async () => {
    const { data, error } = await supabase.auth.getSession();
    // An expired token whose refresh failed on the network comes back as no session plus an
    // error named AuthRetryableFetchError. That is an outage, not a sign-out: throwing here
    // makes the API client report "unavailable" (the retry screen) and never run the
    // sign-out callback below.
    if (error && error.name === 'AuthRetryableFetchError') throw error;
    return data.session?.access_token ?? null;
  },
  // A 401 means this device's token is no longer accepted. Sign out locally only: the
  // refresh token may be what the server rejected, so a network sign-out cannot be relied on.
  // Outages (503, no network, timeouts) never reach this callback.
  onUnauthorized: async () => {
    await supabase.auth.signOut({ scope: 'local' });
  },
});
