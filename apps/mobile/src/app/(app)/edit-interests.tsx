import { useIsMutating } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Keyboard } from 'react-native';
import {
  changeInterestsMutationKey,
  useChangeInterests,
} from '../../features/settings/interests/use-change-interests';
import { useInterests } from '../../api/catalogue/use-interests';
import { useMe } from '../../api/me/use-me';
import { InterestsScreen } from '../../features/settings/interests/InterestsScreen';
import {
  addInterest,
  draftFromSaved,
  interestsToSave,
  toggleCustom,
  toggleSlug,
  type InterestsDraft,
} from '../../features/settings/interests/interests-selection';
import { strings } from '../../strings';
import { showToast } from '../../ui/toast/toast-store';

// «Настройки → Интересы»: a stack screen above the tabs, so it has no bottom bar. The route
// is not `/interests`: onboarding has that one. It works like «Рассказчик» (narrator.tsx):
// nothing changes until «Сохранить изменения», and leaving discards the draft without asking.
//
// Back stays allowed while a save is out: the save finishes and its toast shows wherever the
// person is by then. A successful save closes only the screen that started it, if it is still
// open. A screen opened again while the save is out waits with the spinner and stays open.
export default function EditInterests() {
  const router = useRouter();
  const me = useMe();
  const interests = useInterests();
  // Null until the first edit: until then the screen follows what the server holds.
  const [draft, setDraft] = useState<InterestsDraft | null>(null);

  // In the hook's options, not in `mutate`: they run after the screen is closed too. The
  // error itself is never shown.
  const save = useChangeInterests({
    onSaved: () =>
      showToast({
        label: strings.settings.saveToasts.doneLabel,
        title: strings.settings.saveToasts.interestsSaved,
        kind: 'success',
      }),
    onFailed: () =>
      showToast({ label: '', title: strings.settings.saveToasts.failed, kind: 'alert' }),
  });
  // Counted by key, so a screen opened again while an earlier save is out also waits for it.
  const saving = useIsMutating({ mutationKey: changeInterestsMutationKey }) > 0;

  const saved = me.data?.preferences ?? null;
  const catalogue = interests.data?.interests;
  // Null while /me has no preferences: nothing can be edited then, so a draft never starts
  // from empty lists, whose save would delete what the person has.
  const shown = draft ?? (saved === null ? null : draftFromSaved(saved));
  const toSave = interestsToSave({ saved, draft, catalogue });

  // An edit that changed nothing gives back `shown`, and does not start a draft.
  const keep = (next: InterestsDraft) => {
    if (next !== shown) setDraft(next);
  };

  // Back to where the person came from; a cold start of this route has no history.
  const leave = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/settings');
  }, [router]);

  const onSave = () => {
    if (saving || toSave === null) return;
    // The toast host does not move for the keyboard, so an open one could hide the toast.
    Keyboard.dismiss();
    // `leave` is passed here only: a callback of `mutate` is dropped once the screen is
    // gone, so a person who already left is not sent back a second time.
    save.mutate(toSave, { onSuccess: leave });
  };

  return (
    <InterestsScreen
      catalogue={catalogue}
      // A failed re-read keeps the chips on screen, as the voice list does on «Рассказчик»:
      // after a failed save the selection stays in sight.
      loadFailed={interests.isError && catalogue === undefined}
      onRetry={() => void interests.refetch()}
      selectedSlugs={shown?.slugs ?? []}
      onToggleSlug={(slug) => {
        if (!saving && shown !== null) keep(toggleSlug(shown, slug, catalogue));
      }}
      customChips={(shown?.shownCustom ?? []).map((text) => ({
        text,
        selected: shown?.selectedCustom.includes(text) ?? false,
      }))}
      onPressCustom={(text) => {
        if (!saving && shown !== null) keep(toggleCustom(shown, text));
      }}
      onSubmitText={(text) => {
        // Not taken, so the text stays in the field.
        if (saving || shown === null) return false;
        const added = addInterest(shown, text, catalogue);
        keep(added.draft);
        return added.taken;
      }}
      canSave={toSave !== null}
      saving={saving}
      onSave={onSave}
      onBack={leave}
    />
  );
}
