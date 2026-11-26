import { Stack } from 'expo-router';
import { stackScreenOptions } from '../../ui/navigation/stack-options';

export default function GroupLayout() {
  return <Stack screenOptions={stackScreenOptions} />;
}
