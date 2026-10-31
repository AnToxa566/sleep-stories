import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { colors, radii, typeSizes } from '../theme/tokens';
import { Icon, type IconName } from './icons';
import { TOAST_DURATION_MS, useToastStore, type Toast, type ToastKind } from './toast-store';

type Props = {
  // Distance from the bottom edge of the host (the screen, which ends at the bottom bar) to the toast.
  bottomOffset: number;
};

const ICONS: Record<Exclude<ToastKind, 'plain'>, { icon: IconName; color: string; fill: string }> =
  {
    create: { icon: 'circleDashed', color: colors.muted, fill: colors.toastIconMuted },
    replace: { icon: 'refresh', color: colors.textSoft, fill: colors.toastIconSoft },
    remove: { icon: 'close', color: colors.accent, fill: colors.toastIconAccent },
  };

// Mount once, as the last child of a full-screen container (the screen root). Shows the
// current toast above the bottom bar and hides it after TOAST_DURATION_MS. It never takes
// touches. The timer is a JS timer: fine here, a toast that outlives a backgrounded app is harmless.
export function ToastHost({ bottomOffset }: Props) {
  const current = useToastStore((state) => state.current);
  const hide = useToastStore((state) => state.hide);
  const progress = useRef(new Animated.Value(0)).current;
  // The last toast stays rendered while it fades out.
  const shown = useRef<Toast | null>(null);
  if (current) shown.current = current;

  const id = current?.id;
  useEffect(() => {
    if (id === undefined) {
      Animated.timing(progress, {
        toValue: 0,
        duration: 250,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }).start();
      return;
    }
    progress.setValue(0);
    Animated.timing(progress, {
      toValue: 1,
      duration: 300,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
    const timer = setTimeout(() => hide(id), TOAST_DURATION_MS);
    return () => clearTimeout(timer);
  }, [id, hide, progress]);

  const toast = shown.current;
  if (!toast) return null;
  const style = toast.kind === 'plain' ? null : ICONS[toast.kind];

  return (
    <Animated.View
      pointerEvents="none"
      accessibilityLiveRegion="polite"
      style={[
        styles.toast,
        {
          bottom: bottomOffset,
          opacity: progress,
          transform: [
            { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) },
          ],
        },
      ]}
    >
      {style ? (
        <View style={[styles.iconCircle, { backgroundColor: style.fill }]}>
          <Icon name={style.icon} size={20} color={style.color} />
        </View>
      ) : null}
      <View style={styles.texts}>
        <Text style={styles.label}>{toast.label}</Text>
        {toast.title ? <Text style={styles.title}>{toast.title}</Text> : null}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  toast: {
    position: 'absolute',
    left: 24,
    right: 24,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 20,
    backgroundColor: colors.toast,
    borderWidth: 1,
    borderColor: colors.hairline,
    // Android draws the shadow with elevation; iOS uses the shadow props.
    elevation: 8,
    shadowColor: '#000000',
    shadowOpacity: 0.45,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 12 },
  },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: radii.chip,
    alignItems: 'center',
    justifyContent: 'center',
  },
  texts: { flex: 1, minWidth: 0, gap: 3, paddingRight: 8 },
  label: { color: colors.muted, fontSize: typeSizes.caption },
  title: { color: colors.textSoft, fontSize: typeSizes.body },
});
