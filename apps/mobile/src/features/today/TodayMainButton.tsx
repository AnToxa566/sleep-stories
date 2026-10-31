import { StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { colors, radii, sizes, typeSizes } from '../../theme/tokens';
import { Icon } from '../../ui/icons';
import { PrimaryButton } from '../../ui/PrimaryButton';
import type { MainButtonView } from './main-button';

type Props = {
  view: MainButtonView;
  // 0..1, the estimated fill of the «Создаётся…» button.
  progress: number;
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
  const active = view.kind === 'start' || view.kind === 'create-and-start';
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
          {view.showsProgress ? (
            <View style={[styles.fillBox, { width: `${Math.round(progress * 100)}%` }]}>
              <Svg width="100%" height="100%" preserveAspectRatio="none">
                <Defs>
                  <LinearGradient id="creatingFill" x1="0" y1="0" x2="1" y2="0">
                    <Stop offset="0" stopColor={colors.accent} stopOpacity={0.16} />
                    <Stop offset="1" stopColor={colors.accentEnd} stopOpacity={0.26} />
                  </LinearGradient>
                </Defs>
                <Rect width="100%" height="100%" fill="url(#creatingFill)" />
              </Svg>
            </View>
          ) : null}
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
  fillBox: { position: 'absolute', left: 0, top: 0, bottom: 0 },
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
