import { useRouter } from 'expo-router';
import { useMe, useVoices } from '../../../api/queries';
import { signOutEverywhere, useSessionStore } from '../../../features/auth/session/session-store';
import { SettingsScreen } from '../../../features/settings/SettingsScreen';
import { settingsSummary } from '../../../features/settings/summary/settings-summary';
import { useQueue } from '../../../features/today/queue-data/queue-queries';

// «Настройки». The route gathers the values, because the allowance comes with the queue, which
// belongs to `today`, and features/settings may not import it. The queue is only read here.
// After a sign-out the root layout's gate sends the person to the auth screens.
// `navigate`, not `push`: a double tap on a row opens one screen.
export default function Settings() {
  const router = useRouter();
  const me = useMe();
  const voices = useVoices();
  const queue = useQueue();
  const email = useSessionStore((state) => state.email);

  const summary = settingsSummary({
    preferences: me.data?.preferences ?? null,
    voices: voices.data?.voices,
    email,
    generations: queue.data?.generations,
  });

  return (
    <SettingsScreen
      summary={summary}
      onOpenNarrator={() => router.navigate('/narrator')}
      onOpenInterests={() => router.navigate('/edit-interests')}
      onOpenStyles={() => router.navigate('/edit-styles')}
      onSignOut={() => void signOutEverywhere()}
    />
  );
}
