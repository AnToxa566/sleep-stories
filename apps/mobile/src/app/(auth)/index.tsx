import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { strings } from '../../strings';
import { colors, spacing, typeSizes } from '../../theme/tokens';
import { Orb } from '../../ui/Orb';
import { PrimaryButton } from '../../ui/PrimaryButton';
import { Screen } from '../../ui/Screen';
import { SecondaryButton } from '../../ui/SecondaryButton';

// The first screen of a signed-out user: no form, two ways in. The one primary action is
// "Создать аккаунт"; "У меня есть аккаунт" is the quiet alternative. Apple and Google are
// drawn as in the design but are not wired (out of scope for this feature).
export default function Welcome() {
  const router = useRouter();

  return (
    <Screen scroll>
      <View style={styles.top}>
        <Orb size={96} />
        <View style={styles.titles}>
          <Text style={styles.name}>{strings.auth.appName}</Text>
          <Text style={styles.tagline}>{strings.auth.tagline}</Text>
        </View>
      </View>

      <View style={styles.bottom}>
        <Text style={styles.intro}>{strings.auth.intro}</Text>
        {/* Not wired yet: accessible, but a press does nothing. */}
        <SecondaryButton label={strings.auth.continueWithApple} onPress={noop} />
        <SecondaryButton label={strings.auth.continueWithGoogle} onPress={noop} />
        <View style={styles.divider}>
          <View style={styles.rule} />
          <Text style={styles.dividerLabel}>{strings.auth.orByEmail}</Text>
          <View style={styles.rule} />
        </View>

        <View style={styles.primary}>
          <PrimaryButton
            label={strings.auth.createAccount}
            onPress={() => router.push('/sign-up')}
          />
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={strings.auth.haveAccount}
          onPress={() => router.push('/sign-in')}
          style={({ pressed }) => [styles.quiet, pressed && styles.pressed]}
        >
          <Text style={styles.quietLabel}>{strings.auth.haveAccount}</Text>
        </Pressable>
      </View>
    </Screen>
  );
}

function noop(): void {
  // Intentionally empty.
}

const styles = StyleSheet.create({
  top: { alignItems: 'center', gap: 22, marginTop: 56 },
  titles: { alignItems: 'center', gap: 10, marginTop: 10 },
  name: { color: colors.text, fontSize: typeSizes.display, letterSpacing: -0.3 },
  tagline: {
    color: colors.muted,
    fontSize: typeSizes.bodyLarge,
    lineHeight: 24,
    textAlign: 'center',
  },
  bottom: { marginTop: 'auto', paddingTop: spacing.xxl, gap: spacing.md },
  intro: {
    color: colors.muted,
    fontSize: typeSizes.small,
    lineHeight: 21,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  divider: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 10 },
  rule: { flex: 1, height: 1, backgroundColor: colors.hairline },
  dividerLabel: { color: colors.muted, fontSize: typeSizes.caption },
  primary: { marginTop: 6 },
  quiet: { height: 52, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.7 },
  quietLabel: { color: colors.textSoft, fontSize: typeSizes.body, fontWeight: '500' },
});
