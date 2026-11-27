import { useIsFocused } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { strings } from '../../strings';
import { colors, spacing, typeSizes } from '../../theme/tokens';
import { NightBackground } from '../../ui/layout/NightBackground';
import { ToastHost } from '../../ui/toast/ToastHost';
import { Text } from '../../ui/typography/typography';
import { DangerZone } from './danger-zone/DangerZone';
import { SettingsRow, SettingsSection } from './rows/SettingsRow';
import type { SettingsSummary } from './summary/settings-summary';

// The space between a toast and the bottom bar, as on the other tabs.
const TOAST_GAP = 16;

type Props = {
  summary: SettingsSummary;
  onOpenNarrator: () => void;
  onOpenInterests: () => void;
  onOpenStyles: () => void;
  onSignOut: () => void;
};

// «Настройки» (design frame 4b). It shows the person's choices. The narrator, interests and
// styles rows open their screens and «Выйти» signs out. The mail and generations rows and
// «Удалить аккаунт» are drawn but take no taps yet.
export function SettingsScreen({
  summary,
  onOpenNarrator,
  onOpenInterests,
  onOpenStyles,
  onSignOut,
}: Props) {
  const copy = strings.settings;
  // The other tabs stay mounted, so only the screen in front draws the toast.
  const focused = useIsFocused();
  return (
    <View style={styles.root}>
      <NightBackground />
      <SafeAreaView edges={['top']} style={styles.safe}>
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.title}>{copy.title}</Text>
          <SettingsSection title={copy.voiceSection}>
            <SettingsRow
              label={copy.narrator}
              value={summary.voiceName}
              accessory="chevron"
              onPress={onOpenNarrator}
            />
          </SettingsSection>
          <SettingsSection title={copy.topicsSection}>
            <SettingsRow
              label={copy.interests}
              value={summary.interests}
              accessory="chevron"
              onPress={onOpenInterests}
            />
            <SettingsRow
              label={copy.styles}
              value={summary.styles}
              accessory="chevron"
              onPress={onOpenStyles}
            />
          </SettingsSection>
          <SettingsSection title={copy.accountSection}>
            <SettingsRow label={copy.email} value={summary.email} />
            <SettingsRow label={copy.generations} value={summary.generations} accessory="info" />
            <SettingsRow label={copy.logout} onPress={onSignOut} />
          </SettingsSection>
          <DangerZone />
        </ScrollView>
      </SafeAreaView>
      {focused ? <ToastHost bottomOffset={TOAST_GAP} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1 },
  content: { paddingHorizontal: spacing.xxl, paddingBottom: spacing.xxl },
  title: { marginTop: 24, color: colors.text, fontSize: typeSizes.title, fontWeight: '400' },
});
