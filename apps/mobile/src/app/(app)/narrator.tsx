import { useIsMutating, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { useVoices, voicesQueryKey } from '../../api/catalogue/use-voices';
import { useMe } from '../../api/me/use-me';
import {
  changeVoiceMutationKey,
  useChangeVoice,
} from '../../features/settings/narrator/use-change-voice';
import { NarratorScreen } from '../../features/settings/narrator/NarratorScreen';
import { narratorSelection } from '../../features/settings/narrator/narrator-selection';
import { strings } from '../../strings';
import { showToast } from '../../ui/toast/toast-store';
import { useVoiceSample } from '../../ui/voice/useVoiceSample';

// «Настройки → Рассказчик»: a stack screen above the tabs, so it has no bottom bar. Nothing
// changes until «Сохранить изменения». The pick lives in this screen only, so leaving (the
// link, the Android back key or the gesture) discards it without asking.
//
// Back stays allowed while a save is out: the save finishes and its toast shows wherever the
// person is by then. A successful save closes only the screen that started it, if it is still
// open. A screen opened again while the save is out waits with the spinner and stays open.
export default function Narrator() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const me = useMe();
  const voices = useVoices();
  const [picked, setPicked] = useState<string | null>(null);
  const sample = useVoiceSample(
    () => void queryClient.invalidateQueries({ queryKey: voicesQueryKey }),
  );

  // In the hook's options, not in `mutate`: they run after the screen is closed too. The
  // error itself is never shown.
  const save = useChangeVoice({
    onSaved: () =>
      showToast({
        label: strings.settings.saveToasts.doneLabel,
        title: strings.settings.saveToasts.narratorSaved,
        kind: 'success',
      }),
    onFailed: () =>
      showToast({ label: '', title: strings.settings.saveToasts.failed, kind: 'alert' }),
  });
  // Counted by key, so a screen opened again while an earlier save is out also waits for it.
  const saving = useIsMutating({ mutationKey: changeVoiceMutationKey }) > 0;

  const { selected, toSave } = narratorSelection({
    saved: me.data?.preferences?.voiceSlug ?? null,
    picked,
    voices: voices.data?.voices,
  });

  // Back to where the person came from; a cold start of this route has no history.
  const leave = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/settings');
  }, [router]);

  const onSave = () => {
    if (saving || toSave === null) return;
    sample.stop();
    // `leave` is passed here only: a callback of `mutate` is dropped once the screen is
    // gone, so a person who already left is not sent back a second time.
    save.mutate({ voiceSlug: toSave }, { onSuccess: leave });
  };

  return (
    <NarratorScreen
      voices={voices.data?.voices}
      loadError={voices.isError}
      onRetry={() => void voices.refetch()}
      selectedSlug={selected}
      onSelect={(slug) => {
        if (!saving) setPicked(slug);
      }}
      playingSlug={sample.playingSlug}
      onToggleSample={sample.toggle}
      playFailed={sample.failed}
      canSave={toSave !== null}
      saving={saving}
      onSave={onSave}
      onBack={leave}
    />
  );
}
