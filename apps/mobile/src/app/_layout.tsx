import { QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { queryClient } from '../api/query-client';
import { useMe } from '../api/queries';
import { registerSignOutCleanup, useSessionStore } from '../features/auth/session-store';
import { resolveGate, toMeState } from '../features/gate/resolve-gate';
import { useOnboardingStore } from '../features/onboarding/onboarding-store';
import { useOnestFonts } from '../theme/load-fonts';
import { stackScreenOptions } from '../ui/stack-options';

// Keep the native splash up until the gate knows where to go and the fonts are ready. Module scope, as required:
// it must run before the first render.
void SplashScreen.preventAutoHideAsync();

// After logout nothing of the previous account may stay in memory.
registerSignOutCleanup(() => queryClient.clear());
// ...nor the onboarding answers.
registerSignOutCleanup(() => useOnboardingStore.getState().reset());

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryClientProvider client={queryClient}>
        <Gate />
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}

// One place decides which route group is reachable. Stack.Protected removes the guarded-out
// groups from the navigator, so a signed-out user cannot land on Home by any route, and
// the router moves to the first reachable group when a guard flips (sign-in, onboarding done,
// sign-out).
function Gate() {
  const status = useSessionStore((state) => state.status);
  const me = useMe();
  const fontsReady = useOnestFonts();
  const gate = resolveGate(
    status,
    toMeState({ status: me.status, data: me.data, error: me.error }),
  );

  useEffect(() => {
    if (gate !== 'splash' && fontsReady) void SplashScreen.hideAsync();
  }, [gate, fontsReady]);

  // Render nothing while undecided: the native splash is still showing, and no screen
  // (least of all the sign-in screen) flashes at a user who is already signed in. Nothing is
  // drawn before the fonts are ready either, so no text appears in the system font first.
  if (gate === 'splash' || !fontsReady) return null;

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
