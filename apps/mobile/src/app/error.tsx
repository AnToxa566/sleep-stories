import { StyleSheet, Text, View } from 'react-native';
import { useMe } from '../api/queries';
import { strings } from '../strings';
import { colors, spacing, typeSizes } from '../theme/tokens';
import { PrimaryButton } from '../ui/PrimaryButton';
import { Screen } from '../ui/Screen';

// Shown when /me cannot be loaded for a reason other than 401 (server down, no network).
// The one action refetches /me; on success the gate moves on by itself.
export default function LoadError() {
  const me = useMe();
  return (
    <Screen>
      <View style={styles.texts}>
        <Text style={styles.title}>{strings.gate.errorTitle}</Text>
        <Text style={styles.body}>{strings.gate.errorBody}</Text>
      </View>
      <PrimaryButton
        label={strings.common.retry}
        loading={me.isFetching}
        onPress={() => void me.refetch()}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  texts: { flex: 1, justifyContent: 'center', gap: spacing.md },
  title: { color: colors.text, fontSize: typeSizes.title },
  body: { color: colors.muted, fontSize: typeSizes.body, lineHeight: 22 },
});
