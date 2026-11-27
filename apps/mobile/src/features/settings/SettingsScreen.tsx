import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { strings } from '../../strings';
import { colors, spacing, typeSizes } from '../../theme/tokens';
import { NightBackground } from '../../ui/layout/NightBackground';
import { Text } from '../../ui/typography/typography';
import { DangerZone } from './danger-zone/DangerZone';
import { SettingsRow, SettingsSection } from './rows/SettingsRow';
import type { SettingsSummary } from './summary/settings-summary';

type Props = {
  summary: SettingsSummary;
  onSignOut: () => void;
};

// «Настройки» (design frame 4b). It shows the person's choices; signing out is the only
// thing it does. The other rows and «Удалить аккаунт» are drawn but take no taps yet.
export function SettingsScreen({ summary, onSignOut }: Props) {
  const copy = strings.settings;
  return (
    <View style={styles.root}>
      <NightBackground />
      <SafeAreaView edges={['top']} style={styles.safe}>
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.title}>{copy.title}</Text>
          <SettingsSection title={copy.voiceSection}>
            <SettingsRow label={copy.narrator} value={summary.voiceName} accessory="chevron" />
          </SettingsSection>
          <SettingsSection title={copy.topicsSection}>
            <SettingsRow label={copy.interests} value={summary.interests} accessory="chevron" />
            <SettingsRow label={copy.styles} value={summary.styles} accessory="chevron" />
          </SettingsSection>
          <SettingsSection title={copy.accountSection}>
            <SettingsRow label={copy.email} value={summary.email} />
            <SettingsRow label={copy.generations} value={summary.generations} accessory="info" />
            <SettingsRow label={copy.logout} onPress={onSignOut} />
          </SettingsSection>
          <DangerZone />
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1 },
  content: { paddingHorizontal: spacing.xxl, paddingBottom: spacing.xxl },
  title: { marginTop: 24, color: colors.text, fontSize: typeSizes.title, fontWeight: '400' },
});
