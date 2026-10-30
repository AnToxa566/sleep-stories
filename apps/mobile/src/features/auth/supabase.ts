import { createClient } from '@supabase/supabase-js';
import { AppState } from 'react-native';
import { env } from '../../config/env';
import { createEncryptedStorage } from './encrypted-storage';
import { createExpoStorageDeps } from './expo-storage-deps';

// Explicit storage key. The default is derived from the Supabase URL host, so changing the
// LAN IP during local testing would silently orphan the stored session. Also the name the
// logout path removes by hand.
export const AUTH_STORAGE_KEY = 'sleep-stories.auth';

export const authStorage = createEncryptedStorage(createExpoStorageDeps());

export const supabase = createClient(env.supabaseUrl, env.supabasePublishableKey, {
  auth: {
    storage: authStorage,
    storageKey: AUTH_STORAGE_KEY,
    autoRefreshToken: true,
    persistSession: true,
    // No browser URL in a native app.
    detectSessionInUrl: false,
    // No custom `lock`: since supabase-js 2.x the client coordinates refreshes itself and
    // the option is deprecated (a lock only opts into a legacy path).
  },
});

// Outside a browser the library cannot tell whether the app is in the foreground, so it
// must be told (Supabase React Native guide): refresh tokens while active, stop in the
// background. Registered once, at module scope.
AppState.addEventListener('change', (state) => {
  if (state === 'active') {
    void supabase.auth.startAutoRefresh();
  } else {
    void supabase.auth.stopAutoRefresh();
  }
});
