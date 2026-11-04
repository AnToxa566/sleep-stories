import { StyleSheet, View, type Animated } from 'react-native';
import { Text } from '../../ui/typography';
import { colors, radii, sizes, typeSizes } from '../../theme/tokens';
import { Icon } from '../../ui/icons';
import { PrimaryButton } from '../../ui/PrimaryButton';
import type { MainButtonView } from './main-button';
import { ProgressFill } from './ProgressFill';

type Props = {
  view: MainButtonView;
  // 0..1, the fake fill of the «Создаётся…» button.
  progress: Animated.Value;
  // True while the request of the main button is in flight.
  busy: boolean;
  onPress: () => void;
  // The caption's «готовые истории» link: opens «Темы» with «Готовые» on.
  onOpenReady: () => void;
};

// The main button of «Сегодня» and the sentence under it. The look follows the state
// (design frames 2a to 2a·4): the gradient pill when there is something to press, an outlined
// pill with a growing fill while creating, a dim outlined pill when the allowance is short.
// The caption's «готовые истории» link opens the topics screen on the ready filter.
export function TodayMainButton({ view, progress, busy, onPress, onOpenReady }: Props) {
  const active = view.kind === 'start' || view.kind === 'create';
  return (
    <View style={styles.wrap}>
      {active ? (
        <PrimaryButton
          label={view.label}
          onPress={onPress}
          loading={busy}
          icon={view.kind === 'start' ? 'play' : 'sparkle'}
        />
      ) : (
        <View
          accessibilityRole="button"
          accessibilityLabel={view.label}
          accessibilityState={{ disabled: true, busy: view.showsProgress }}
          style={styles.outlined}
        >
          {view.showsProgress ? <ProgressFill progress={progress} gradientId="creatingFill" /> : null}
          {view.kind === 'create-blocked' ? (
            <Icon name="sparkle" size={18} color={colors.placeholder} strokeWidth={1.8} />
          ) : null}
          <Text style={[styles.label, !view.showsProgress && styles.labelDim]}>{view.label}</Text>
        </View>
      )}
      <Text style={styles.caption}>
        {view.caption.text}
        {view.caption.link ? (
          <>
            {' '}
            <Text accessibilityRole="link" onPress={onOpenReady} style={styles.link}>
              {view.caption.link.label}
            </Text>
            {view.caption.link.tail}
          </>
        ) : null}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 14, marginTop: 30 },
  outlined: {
    height: sizes.buttonHeight,
    borderRadius: radii.button,
    borderWidth: 1,
    borderColor: colors.outlineSoft,
    overflow: 'hidden',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  label: { color: colors.textSoft, fontSize: typeSizes.input, fontWeight: '500' },
  labelDim: { color: colors.placeholder },
  caption: {
    color: colors.muted,
    fontSize: typeSizes.caption,
    lineHeight: 20,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  link: { color: colors.accent },
});
