import { useIsFocused } from 'expo-router';
import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { strings } from '../../../strings';
import { colors, minTouchTarget, sizes, spacing, typeSizes } from '../../../theme/tokens';
import { PrimaryButton } from '../../../ui/buttons/PrimaryButton';
import { Icon } from '../../../ui/icons/icons';
import { Screen } from '../../../ui/layout/Screen';
import { ToastHost } from '../../../ui/toast/ToastHost';
import { Text } from '../../../ui/typography/typography';
import { VoiceList } from '../../../ui/voice/VoiceList';

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
  const focused = useIsFocused();
  const insets = useSafeAreaInsets();
  // Above the button, which ends the page: Screen keeps `spacing.huge` and the inset below it.
  const toastOffset = insets.bottom + spacing.huge + sizes.buttonHeight + spacing.sm;

  return (
    <View style={styles.root}>
      <Screen
        scroll
        header={
          <View style={styles.topBar}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={copy.back}
              onPress={onBack}
              style={({ pressed }) => [styles.back, pressed && styles.pressed]}
            >
              <Icon name="back" size={20} color={colors.accent} />
              <Text style={styles.backText}>{copy.back}</Text>
            </Pressable>
          </View>
        }
      >
        <Text accessibilityRole="header" style={styles.title}>
          {copy.title}
        </Text>
        <Text style={styles.subtitle}>{copy.subtitle}</Text>
        <VoiceList {...voiceList} />
        <View style={styles.bottom}>
          <PrimaryButton
            label={copy.save}
            onPress={onSave}
            // While saving the button keeps its colour and shows the spinner; it takes no
            // press then.
            disabled={!canSave && !saving}
            loading={saving}
          />
        </View>
      </Screen>
      {focused ? <ToastHost bottomOffset={toastOffset} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  topBar: {
    height: 52,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
  },
  back: {
    height: minTouchTarget,
    paddingHorizontal: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  pressed: { opacity: 0.7 },
  backText: { color: colors.accent, fontSize: typeSizes.bodyLarge },
  title: { marginTop: spacing.sm, color: colors.text, fontSize: typeSizes.title, fontWeight: '400' },
  subtitle: { marginTop: spacing.sm, color: colors.muted, fontSize: typeSizes.body },
  bottom: { marginTop: 'auto', paddingTop: spacing.xxl },
});
