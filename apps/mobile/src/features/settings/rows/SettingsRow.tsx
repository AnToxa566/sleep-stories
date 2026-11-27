import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { colors, spacing, typeSizes } from '../../../theme/tokens';
import { Icon } from '../../../ui/icons/icons';
import { Text } from '../../../ui/typography/typography';

export function SettingsSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View>
      <Text style={styles.sectionLabel}>{title}</Text>
      <View style={styles.group}>{children}</View>
    </View>
  );
}

type RowProps = {
  label: string;
  value?: string;
  // What the design draws after the value. It is a picture: it takes no tap of its own.
  // 'chevron' goes with a muted value, 'info' with the brighter allowance.
  accessory?: 'chevron' | 'info';
  // Only a row that does something gets this. Without it the row is a plain view: no press
  // feedback and no button role (ARCHITECTURE.md section 7).
  onPress?: () => void;
};

export function SettingsRow({ label, value, accessory, onPress }: RowProps) {
  const content = (
    <>
      <Text style={styles.label}>{label}</Text>
      {value === undefined ? null : (
        <View style={[styles.trailing, accessory === 'info' && styles.trailingInfo]}>
          <Text numberOfLines={1} style={[styles.value, accessory === 'info' && styles.allowance]}>
            {value}
          </Text>
          {accessory === 'chevron' ? (
            <Icon name="chevronRight" size={16} color={colors.muted} />
          ) : null}
          {accessory === 'info' ? <Icon name="info" size={18} color={colors.muted} /> : null}
        </View>
      )}
    </>
  );

  if (!onPress) return <View style={styles.row}>{content}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  sectionLabel: {
    marginTop: spacing.xxl,
    marginBottom: 6,
    color: colors.muted,
    fontSize: typeSizes.eyebrow,
    fontWeight: '500',
    letterSpacing: 2.2,
    textTransform: 'uppercase',
  },
  group: { borderTopWidth: 1, borderTopColor: colors.hairline },
  row: {
    // A minimum, so a large system font makes the row taller instead of clipping it.
    minHeight: 54,
    paddingVertical: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  pressed: { opacity: 0.7 },
  label: { color: colors.textSoft, fontSize: typeSizes.bodyLarge },
  // Shrinks, so a long email ends in an ellipsis instead of pushing out of the row.
  trailing: { flexShrink: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  trailingInfo: { gap: spacing.sm },
  value: { flexShrink: 1, color: colors.muted, fontSize: typeSizes.body },
  allowance: { color: colors.textSoft, fontVariant: ['tabular-nums'] },
});
