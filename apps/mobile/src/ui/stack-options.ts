import type { ComponentProps } from 'react';
import type { Stack } from 'expo-router';
import { colors } from '../theme/tokens';

// Shared by every stack: no header (screens draw their own), dark content background so
// no white flashes between screens.
export const stackScreenOptions: ComponentProps<typeof Stack>['screenOptions'] = {
  headerShown: false,
  contentStyle: { backgroundColor: colors.base },
};
