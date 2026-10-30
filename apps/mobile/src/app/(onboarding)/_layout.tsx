import { Stack } from 'expo-router';
import { stackScreenOptions } from '../../ui/stack-options';

// `voice` is the first step. Route files are otherwise ordered alphabetically, which would
// put `interests` first, so the initial route is stated, and `voice` is listed first too.
export const unstable_settings = { initialRouteName: 'voice' };

export default function GroupLayout() {
  return (
    <Stack screenOptions={stackScreenOptions}>
      <Stack.Screen name="voice" />
      <Stack.Screen name="interests" />
      <Stack.Screen name="permissions" />
    </Stack>
  );
}
