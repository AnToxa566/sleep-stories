import type { ComponentProps } from 'react';
import { strings } from '../../../strings';
import { InterestPicker } from '../../../ui/interests/InterestPicker';
import { SettingsEditScreen } from '../edit-screen/SettingsEditScreen';

type Props = ComponentProps<typeof InterestPicker> & {
  canSave: boolean;
  saving: boolean;
  onSave: () => void;
  onBack: () => void;
};

// «Настройки → Интересы» (design frame 4d). It only draws: the route decides what is shown
// and selected, and saves. The chips and the field are the ones of onboarding. The frame's
// limit counter and warning are not drawn, and the save button ends the page, as on
// «Рассказчик».
export function InterestsScreen({ canSave, saving, onSave, onBack, ...picker }: Props) {
  const copy = strings.settings.interestsScreen;

  return (
    <SettingsEditScreen
      title={copy.title}
      subtitle={copy.subtitle}
      canSave={canSave}
      saving={saving}
      onSave={onSave}
      onBack={onBack}
    >
      <InterestPicker {...picker} />
    </SettingsEditScreen>
  );
}
