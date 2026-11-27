import { StyleSheet, View } from 'react-native';
import { strings } from '../../../strings';
import { colors, spacing, typeSizes } from '../../../theme/tokens';
import { Text } from '../../../ui/typography/typography';

// The danger zone as drawn (design frame 4b). «Удалить аккаунт» only looks like a button:
// account deletion is not decided (ARCHITECTURE.md section 11), so it is a plain view.
export function DangerZone() {
  return (
    <View>
      <Text style={styles.sectionLabel}>{strings.settings.dangerZone}</Text>
      <View style={styles.card}>
        <Text style={styles.body}>{strings.settings.dangerText}</Text>
        <View style={styles.button}>
          <Text style={styles.buttonLabel}>{strings.settings.deleteAccount}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  sectionLabel: {
    marginTop: spacing.huge,
    marginBottom: 10,
    color: colors.dangerZone,
    fontSize: typeSizes.eyebrow,
    fontWeight: '500',
    letterSpacing: 2.2,
    textTransform: 'uppercase',
  },
  card: {
    padding: 18,
    gap: 14,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.dangerZoneOutline,
  },
  body: { color: colors.muted, fontSize: typeSizes.small, lineHeight: 20 },
  button: {
    height: 48,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.dangerZoneButtonOutline,
    backgroundColor: colors.dangerZoneButtonTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonLabel: {
    color: colors.dangerZoneText,
    fontSize: typeSizes.bodyLarge,
    fontWeight: '500',
  },
});
