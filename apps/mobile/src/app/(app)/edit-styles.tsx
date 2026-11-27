import type { StoryStyle } from '@sleep-stories/contracts';
import { useIsMutating } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  changeStylesMutationKey,
  useChangeStyles,
} from '../../api/preference-change/use-change-styles';
import { useMe } from '../../api/queries';
import { StoryStylesScreen } from '../../features/settings/story-styles/StoryStylesScreen';
import {
  stylesToSave,
  toggleStyle,
} from '../../features/settings/story-styles/story-styles-selection';
import { strings } from '../../strings';
import { showToast } from '../../ui/toast/toast-store';

// «Настройки → Стили»: a stack screen above the tabs, so it has no bottom bar. It works like
// «Интересы» (edit-interests.tsx): nothing changes until «Сохранить изменения», and leaving
// discards the draft without asking.
//
// Back stays allowed while a save is out: the save finishes and its toast shows wherever the
// person is by then. A successful save closes only the screen that started it, if it is still
// open. A screen opened again while the save is out waits with the spinner and stays open.
export default function EditStyles() {
  const router = useRouter();
  const me = useMe();
  // Null until the first tap: until then the screen follows what the server holds.
  const [draft, setDraft] = useState<readonly StoryStyle[] | null>(null);

  // In the hook's options, not in `mutate`: they run after the screen is closed too. The
  // error itself is never shown.
  const save = useChangeStyles({
    onSaved: () =>
      showToast({
        label: strings.settings.saveToasts.doneLabel,
        title: strings.settings.saveToasts.stylesSaved,
        kind: 'success',
      }),
    onFailed: () =>
      showToast({ label: '', title: strings.settings.saveToasts.failed, kind: 'alert' }),
  });
  // Counted by key, so a screen opened again while an earlier save is out also waits for it.
  const saving = useIsMutating({ mutationKey: changeStylesMutationKey }) > 0;

  const saved = me.data?.preferences?.styles ?? null;
  // Null while /me has no preferences: nothing is ticked and taps are ignored, so a draft never
  // starts from an empty list, whose save would drop the styles the person has.
  const shown = draft ?? saved;
  const toSave = stylesToSave({ saved, draft });

  // Back to where the person came from; a cold start of this route has no history.
  const leave = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/settings');
  }, [router]);

  const onSave = () => {
    if (saving || toSave === null) return;
    // `leave` is passed here only: a callback of `mutate` is dropped once the screen is
    // gone, so a person who already left is not sent back a second time.
    save.mutate(toSave, { onSuccess: leave });
  };

  return (
    <StoryStylesScreen
      selected={shown ?? []}
      onToggle={(style) => {
        if (!saving && shown !== null) setDraft(toggleStyle(shown, style));
      }}
      canSave={toSave !== null}
      saving={saving}
      onSave={onSave}
      onBack={leave}
    />
  );
}
