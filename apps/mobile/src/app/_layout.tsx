import { QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { queryClient } from '../api/query-client';
import { useMe } from '../api/queries';
import { registerSignOutCleanup, useSessionStore } from '../features/auth/session-store';
import { resolveGate, toMeState } from '../features/gate/resolve-gate';
import { useOnboardingStore } from '../features/onboarding/onboarding-store';
import { stackScreenOptions } from '../ui/stack-options';

// Keep the native splash up until the gate knows where to go. Module scope, as required:
// it must run before the first render.
void SplashScreen.preventAutoHideAsync();

// After logout nothing of the previous account may stay in memory.
registerSignOutCleanup(() => queryClient.clear());
// ...nor the onboarding answers.
registerSignOutCleanup(() => useOnboardingStore.getState().reset());

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <Gate />
    </QueryClientProvider>
  );
}

// One place decides which route group is reachable. Stack.Protected removes the guarded-out
// groups from the navigator, so a signed-out user cannot land on Home by any route, and
// the router moves to the first reachable group when a guard flips (sign-in, onboarding done,
// sign-out).
function Gate() {
  const status = useSessionStore((state) => state.status);
  const me = useMe();
  const gate = resolveGate(
    status,
    toMeState({ status: me.status, data: me.data, error: me.error }),
  );

  useEffect(() => {
    if (gate !== 'splash') void SplashScreen.hideAsync();
  }, [gate]);

  // Render nothing while undecided: the native splash is still showing, and no screen
  // (least of all the sign-in screen) flashes at a user who is already signed in.
  if (gate === 'splash') return null;

  return (
    <Stack screenOptions={stackScreenOptions}>
      <Stack.Protected guard={gate === 'auth'}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
      <Stack.Protected guard={gate === 'onboarding'}>
        <Stack.Screen name="(onboarding)" />
      </Stack.Protected>
      <Stack.Protected guard={gate === 'home'}>
        <Stack.Screen name="(app)" />
      </Stack.Protected>
      <Stack.Protected guard={gate === 'error'}>
        <Stack.Screen name="error" />
      </Stack.Protected>
    </Stack>
  );
}
