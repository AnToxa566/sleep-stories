import { Stack } from 'expo-router';
import { stackScreenOptions } from '../../ui/stack-options';

// The main area: the tabs («Сегодня», «Темы») at the bottom of the stack, with the screens
// that sit above them and have no bar («Замена») pushed on top. A cold start of a deep link
// to «Замена» still has the tabs below it.
export const unstable_settings = { initialRouteName: '(tabs)' };

export default function GroupLayout() {
  return (
    <Stack screenOptions={stackScreenOptions}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="replace" />
    </Stack>
  );
}
