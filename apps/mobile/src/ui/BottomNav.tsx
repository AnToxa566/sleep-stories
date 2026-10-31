import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { strings } from '../strings';
import { colors, typeSizes } from '../theme/tokens';
import { Icon, type IconName } from './icons';

// Height of the bar without the bottom safe-area inset (design: 86 px with a 24 px bottom pad).
export const BOTTOM_NAV_HEIGHT = 62;

type Tab = { key: 'today' | 'topics' | 'settings'; label: string; icon: IconName; active: boolean };

const TABS: readonly Tab[] = [
  { key: 'today', label: strings.nav.today, icon: 'moon', active: true },
  { key: 'topics', label: strings.nav.topics, icon: 'compass', active: false },
  { key: 'settings', label: strings.nav.settings, icon: 'sliders', active: false },
];

// The bottom bar of the main screens. A plain component, not Expo Router Tabs: only «Сегодня»
// exists for now, so «Темы» and «Настройки» are drawn dimmed and cannot be pressed (the
// accessibility state says disabled). The Library is not in the MVP. Absolute-positioned at the
// bottom of its parent; the parent reserves BOTTOM_NAV_HEIGHT plus the inset for the content.
export function BottomNav() {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.bar, { paddingBottom: insets.bottom }]}>
      {TABS.map((tab) => {
        const color = tab.active ? colors.accent : colors.muted;
        return (
          <Pressable
            key={tab.key}
            accessibilityRole="tab"
            accessibilityLabel={tab.label}
            accessibilityState={{ selected: tab.active, disabled: !tab.active }}
            disabled
            style={[styles.tab, !tab.active && styles.inert]}
          >
            <Icon name={tab.icon} size={22} color={color} />
            <Text style={[styles.label, { color }]}>{tab.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    backgroundColor: colors.navBar,
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
  },
  tab: {
    flex: 1,
    height: BOTTOM_NAV_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  inert: { opacity: 0.45 },
  label: { fontSize: typeSizes.eyebrow, fontWeight: '500' },
});
