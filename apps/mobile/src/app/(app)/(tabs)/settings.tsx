import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { signOutEverywhere } from '../../../features/auth/session-store';
import { strings } from '../../../strings';
import { spacing } from '../../../theme/tokens';
import { NightBackground } from '../../../ui/NightBackground';
import { SecondaryButton } from '../../../ui/SecondaryButton';

// Temporary «Настройки»: one sign-out button, for testing on a phone. The root layout's gate
// sends the signed-out person to the auth screens. The real settings screen replaces this.
export default function Settings() {
  return (
    <View style={styles.root}>
      <NightBackground />
      <SafeAreaView edges={['top']} style={styles.safe}>
        <View style={styles.body}>
          <SecondaryButton label={strings.settings.logout} onPress={() => void signOutEverywhere()} />
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1 },
  body: { flex: 1, justifyContent: 'center', paddingHorizontal: spacing.xxl },
});
