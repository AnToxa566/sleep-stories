import { QueryClient, focusManager } from '@tanstack/react-query';
import { AppState } from 'react-native';
import { ApiContractError, ApiError } from './api-client';

// Refetch stale queries when the app returns to the foreground. React Native has no window
// focus event, so AppState stands in. onlineManager is left at its default (always online):
// reading connectivity needs @react-native-community/netinfo, which is not approved. A
// request made offline fails fast and the error screen offers "Повторить".
focusManager.setEventListener((handleFocus) => {
  const subscription = AppState.addEventListener('change', (state) => {
    handleFocus(state === 'active');
  });
  return () => subscription.remove();
});

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // A 401 signs the user out and a 4xx or a response that breaks the contract will not
      // change on a retry; outages and server errors are retried twice with the library's
      // exponential delay (about 3 s before the error screen).
      retry: (failureCount, error) => {
        if (error instanceof ApiContractError) return false;
        if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
        return failureCount < 2;
      },
    },
  },
});
