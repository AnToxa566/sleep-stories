import { StyleSheet, View, type Animated } from 'react-native';
import { Text } from '../../ui/typography';
import { strings } from '../../strings';
import { colors, radii, sizes, typeSizes } from '../../theme/tokens';
import { Icon } from '../../ui/icons';
import { PrimaryButton } from '../../ui/PrimaryButton';
import { SecondaryButton } from '../../ui/SecondaryButton';
import { SkeletonRows } from '../../ui/SkeletonRows';
import { ProgressFill } from './ProgressFill';

type Props = {
  // The server says a topic suggestion is running (`collecting` in the queue answer).
  collecting: boolean;
  // 0..1, the fake fill of the «Собираем…» pill.
  progress: Animated.Value;
  // «Три истории на темы: …», or null while the interests load or when there are none.
  caption: string | null;
  // True while the request of «Собрать подборку» is in flight.
  collectBusy: boolean;
  onCollect: () => void;
  // «Выбрать истории»: opens the topics screen.
  onChoose: () => void;
};

const SKELETON_ROW_COUNT = 3;

// The empty queue (design frames 2a·12 to 2a·14). Idle: «Собрать подборку» (the one primary
// action; it asks the server for a topic suggestion, no story is generated) and «Выбрать
// истории», which opens the topics screen. Collecting: skeleton rows and an inactive «Собираем…» pill with a fill.
export function EmptyQueue({
  collecting,
  progress,
  caption,
  collectBusy,
  onCollect,
  onChoose,
}: Props) {
  const copy = strings.today.empty;
  return (
    <View>
      <View style={styles.block}>
        <Icon name="circleDashed" size={28} color={colors.muted} />
        <Text style={styles.eyebrow}>{copy.eyebrow}</Text>
        <Text style={styles.title}>{collecting ? copy.collectingTitle : copy.idleTitle}</Text>
        <Text style={styles.body}>{collecting ? copy.collectingBody : copy.idleBody}</Text>
      </View>
      {collecting ? (
        <>
          <View style={styles.skeletons}>
            <SkeletonRows count={SKELETON_ROW_COUNT} />
          </View>
          <View
            accessibilityRole="button"
            accessibilityLabel={copy.collectingPill}
            accessibilityState={{ disabled: true, busy: true }}
            style={styles.pill}
          >
            <ProgressFill progress={progress} gradientId="collectingFill" />
            <Text style={styles.pillLabel}>{copy.collectingPill}</Text>
          </View>
        </>
      ) : (
        <View style={styles.actions}>
          <PrimaryButton label={copy.collectButton} icon="sparkle" loading={collectBusy} onPress={onCollect} />
          <SecondaryButton label={copy.chooseButton} icon="plus" onPress={onChoose} />
          {caption !== null ? <Text style={styles.caption}>{caption}</Text> : null}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    marginTop: 34,
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
    paddingTop: 32,
    gap: 12,
  },
  eyebrow: {
    marginTop: 6,
    color: colors.muted,
    fontSize: typeSizes.eyebrow,
    letterSpacing: 2.2,
    textTransform: 'uppercase',
    fontWeight: '500',
  },
  title: { color: colors.text, fontSize: 21, fontWeight: '500' },
  body: { color: colors.muted, fontSize: typeSizes.body, lineHeight: 22 },
  skeletons: { marginTop: 24 },
  pill: {
    marginTop: 24,
    height: sizes.buttonHeight,
    borderRadius: radii.button,
    borderWidth: 1,
    borderColor: colors.outlineSoft,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillLabel: { color: colors.textSoft, fontSize: typeSizes.input, fontWeight: '500' },
  actions: { marginTop: 28, gap: 12 },
  caption: {
    color: colors.muted,
    fontSize: typeSizes.caption,
    lineHeight: 20,
    textAlign: 'center',
  },
});
