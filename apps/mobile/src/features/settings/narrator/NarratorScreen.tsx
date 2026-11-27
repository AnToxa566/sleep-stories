import type { ComponentProps } from 'react';
import { strings } from '../../../strings';
import { VoiceList } from '../../../ui/voice/VoiceList';
import { SettingsEditScreen } from '../edit-screen/SettingsEditScreen';

type Props = ComponentProps<typeof VoiceList> & {
  canSave: boolean;
  saving: boolean;
  onSave: () => void;
  onBack: () => void;
};

// «Настройки → Рассказчик» (design frame 4c). It only draws: the route decides what is
// selected, plays the samples and saves. The design's ▶ also selects the voice; here it only
// plays, as in the shared list (owner, 2026-11-27).
export function NarratorScreen({ canSave, saving, onSave, onBack, ...voiceList }: Props) {
  const copy = strings.settings.narratorScreen;

  return (
    <SettingsEditScreen
      title={copy.title}
      subtitle={copy.subtitle}
      canSave={canSave}
      saving={saving}
      onSave={onSave}
      onBack={onBack}
    >
      <VoiceList {...voiceList} />
    </SettingsEditScreen>
  );
}
