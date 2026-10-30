import { StyleSheet, Text, View } from 'react-native';
import { colors, spacing, typeSizes } from '../theme/tokens';

type Props = {
  eyebrow: string;
  title: string;
  subtitle?: string;
};

// The eyebrow ("Шаг 1 из 3"), the title and the optional subtitle of an onboarding step.
export function StepHeading({ eyebrow, title, subtitle }: Props) {
  return (
    <View>
      <Text style={styles.eyebrow}>{eyebrow}</Text>
      <Text accessibilityRole="header" style={styles.title}>
        {title}
      </Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  eyebrow: {
    color: colors.accent,
    fontSize: typeSizes.eyebrow,
    fontWeight: '500',
    letterSpacing: 2.2,
    textTransform: 'uppercase',
    marginTop: spacing.huge,
  },
  title: { color: colors.text, fontSize: typeSizes.title, marginTop: spacing.md },
  subtitle: { color: colors.muted, fontSize: typeSizes.body, marginTop: spacing.sm },
});
