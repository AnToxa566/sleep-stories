import { useIsFocused } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { strings } from '../../../strings';
import { colors, minTouchTarget, sizes, spacing, typeSizes } from '../../../theme/tokens';
import { PrimaryButton } from '../../../ui/buttons/PrimaryButton';
import { Icon } from '../../../ui/icons/icons';
import { Screen } from '../../../ui/layout/Screen';
import { ToastHost } from '../../../ui/toast/ToastHost';
import { Text } from '../../../ui/typography/typography';

type Props = {
  title: string;
  subtitle: string;
  // What is being edited, between the subtitle and the save button.
  children: ReactNode;
  canSave: boolean;
  saving: boolean;
  onSave: () => void;
  onBack: () => void;
};

// The frame of a screen that edits one setting (design frames 4c and 4d): the way back to
// «Настройки», the title, the content and the save button. It only draws.
export function SettingsEditScreen({
  title,
  subtitle,
  children,
  canSave,
  saving,
  onSave,
  onBack,
}: Props) {
  const copy = strings.settings.editScreen;
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
          {title}
        </Text>
        <Text style={styles.subtitle}>{subtitle}</Text>
        {children}
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
