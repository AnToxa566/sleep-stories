import type { ReactNode } from 'react';
import { KeyboardAvoidingView, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NightBackground } from './NightBackground';
import { spacing } from '../theme/tokens';

type Props = {
  children: ReactNode;
  // Scrolls when the content is taller than the screen (small phones, big fonts, keyboard).
  scroll?: boolean;
  // Header row above the content (back button, progress segments).
  header?: ReactNode;
};

// Safe-area aware page on the night background. The content gets 28 px side padding.
// `padding` behaviour on both platforms: Android runs edge-to-edge in SDK 57, where the
// system does not resize the window for the keyboard. Cost: confirm on a phone.
export function Screen({ children, scroll = false, header }: Props) {
  return (
    <View style={styles.root}>
      <NightBackground />
      <SafeAreaView style={styles.safe}>
        <KeyboardAvoidingView style={styles.safe} behavior="padding">
          {header}
          {scroll ? (
            <ScrollView
              contentContainerStyle={styles.scrollContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {children}
            </ScrollView>
          ) : (
            <View style={styles.content}>{children}</View>
          )}
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1 },
  content: {
    flex: 1,
    paddingHorizontal: spacing.xxl,
    paddingBottom: spacing.huge,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: spacing.xxl,
    paddingBottom: spacing.huge,
  },
});
