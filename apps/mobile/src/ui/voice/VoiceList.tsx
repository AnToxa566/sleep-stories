import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { strings } from '../../strings';
import { colors, minTouchTarget, spacing, typeSizes } from '../../theme/tokens';
import { SecondaryButton } from '../buttons/SecondaryButton';
import { Icon } from '../icons/icons';
import { SelectRow } from '../inputs/SelectRow';
import { Text } from '../typography/typography';

type VoiceItem = { slug: string; name: string; description: string; sampleUrl: string };

type VoiceListProps = {
  // Undefined until the first load succeeds.
  voices: readonly VoiceItem[] | undefined;
  // Shown only while there are no voices: a failed refetch keeps the list on screen.
  loadError: boolean;
  onRetry: () => void;
  selectedSlug: string | null;
  onSelect: (slug: string) => void;
  playingSlug: string | null;
  onToggleSample: (voice: VoiceItem) => void;
  playFailed: boolean;
};

// The voices to choose from. The round control on each row plays that voice's sample (one at a
// time, see useVoiceSample) and does not select the row; tapping the row selects. While a sample
// plays the same control shows a pause icon (owner's choice; the design shows the small orb
// there).
export function VoiceList({
  voices,
  loadError,
  onRetry,
  selectedSlug,
  onSelect,
  playingSlug,
  onToggleSample,
  playFailed,
}: VoiceListProps) {
  if (voices === undefined) {
    return loadError ? (
      <View style={styles.status}>
        <Text accessibilityRole="alert" style={styles.statusText}>
          {strings.voice.loadFailed}
        </Text>
        <SecondaryButton label={strings.common.retry} onPress={onRetry} />
      </View>
    ) : (
      <View style={styles.status} accessibilityRole="progressbar">
        <ActivityIndicator color={colors.accent} />
        <Text style={styles.statusText}>{strings.voice.loading}</Text>
      </View>
    );
  }

  return (
    <View style={styles.list}>
      {voices.map((voice) => {
        const { slug, name, description } = voice;
        const playing = playingSlug === slug;
        return (
          <SelectRow
            key={slug}
            title={name}
            description={description}
            selected={selectedSlug === slug}
            onPress={() => onSelect(slug)}
            leading={
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${
                  playing ? strings.voice.stopSample : strings.voice.playSample
                }: ${name}`}
                onPress={() => onToggleSample(voice)}
                style={styles.play}
              >
                <Icon name={playing ? 'pause' : 'play'} size={18} />
              </Pressable>
            }
          />
        );
      })}
      {playFailed ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {strings.voice.playFailed}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { marginTop: 26, borderTopWidth: 1, borderTopColor: colors.hairline },
  status: { marginTop: spacing.xl, gap: spacing.lg, alignItems: 'flex-start' },
  statusText: { color: colors.muted, fontSize: typeSizes.body },
  play: {
    width: minTouchTarget,
    height: minTouchTarget,
    borderRadius: minTouchTarget / 2,
    borderWidth: 1,
    borderColor: colors.outline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  error: {
    color: colors.danger,
    fontSize: typeSizes.small,
    paddingTop: spacing.lg,
  },
});
