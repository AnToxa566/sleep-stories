import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { strings } from '../../../strings';
import { colors, spacing, typeSizes } from '../../../theme/tokens';
import { Text } from '../../../ui/typography/typography';
import { useSessionStore } from '../../auth/session/session-store';
import { DeleteAccountSheet } from '../account-deletion/DeleteAccountSheet';

// The danger zone (design frame 4b). «Удалить аккаунт» only opens the confirmation sheet.
// Without a known address there is nothing to confirm against, so the button takes no taps.
export function DangerZone() {
  const email = useSessionStore((state) => state.email);
  const [open, setOpen] = useState(false);
  return (
    <View>
      <Text style={styles.sectionLabel}>{strings.settings.dangerZone}</Text>
      <View style={styles.card}>
        <Text style={styles.body}>{strings.settings.dangerText}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: !email }}
          disabled={!email}
          onPress={() => setOpen(true)}
          style={({ pressed }) => [styles.button, pressed && styles.pressed]}
        >
          <Text style={styles.buttonLabel}>{strings.settings.deleteAccount}</Text>
        </Pressable>
      </View>
      <DeleteAccountSheet visible={open} email={email} onClose={() => setOpen(false)} />
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
  pressed: { opacity: 0.7 },
  buttonLabel: {
    color: colors.dangerZoneText,
    fontSize: typeSizes.bodyLarge,
    fontWeight: '500',
  },
});
