import { StyleSheet, Text, View } from 'react-native';
import { signOutEverywhere } from '../../features/auth/session-store';
import { strings } from '../../strings';
import { colors, spacing, typeSizes } from '../../theme/tokens';
import { PrimaryButton } from '../../ui/PrimaryButton';
import { Screen } from '../../ui/Screen';

// Placeholder Home: the title and the one action (sign out). Logging out removes the stored
// session; the gate then lands on the auth screen, and the query cache and onboarding
// answers are cleared through the sign-out cleanup list.
export default function Home() {
  return (
    <Screen>
      <Text accessibilityRole="header" style={styles.title}>
        {strings.home.title}
      </Text>
      <View style={styles.bottom}>
        <PrimaryButton label={strings.home.signOut} onPress={() => void signOutEverywhere()} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { color: colors.text, fontSize: typeSizes.title, marginTop: 56 },
  bottom: { marginTop: 'auto', paddingTop: spacing.xxl },
});
