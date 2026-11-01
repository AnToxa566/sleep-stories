import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { strings } from '../strings';
import { colors, typeSizes } from '../theme/tokens';
import { Icon, type IconName } from './icons';

// Height of the bar without the bottom safe-area inset (design: 86 px with a 24 px bottom pad).
const TAB_HEIGHT = 62;

type TabCopy = { label: string; icon: IconName };

// By route name. A route not listed here gets no button.
const BUILT_TABS: Readonly<Record<string, TabCopy>> = {
  home: { label: strings.nav.today, icon: 'moon' },
  topics: { label: strings.nav.topics, icon: 'compass' },
  settings: { label: strings.nav.settings, icon: 'sliders' },
};

// The bottom bar of the tabs navigator (the `tabBar` of «Сегодня», «Темы» and «Настройки»). It sits below
// the screens in the layout, not over them, so no screen reserves space for it. `selected` is
// state.index, which changes the moment a tab is pressed, before the screen is drawn.
// The Library is not in the MVP.
export function TabBar({ state, navigation, insets }: BottomTabBarProps) {
  return (
    <View style={[styles.bar, { paddingBottom: insets.bottom }]}>
      {state.routes.map((route, index) => {
        const copy = BUILT_TABS[route.name];
        if (copy === undefined) return null;
        const focused = state.index === index;
        const color = focused ? colors.accent : colors.muted;
        const onPress = () => {
          const event = navigation.emit({
            type: 'tabPress',
            target: route.key,
            canPreventDefault: true,
          });
          if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
        };
        return (
          <Pressable
            key={route.key}
            accessibilityRole="tab"
            accessibilityLabel={copy.label}
            accessibilityState={{ selected: focused }}
            onPress={onPress}
            style={styles.tab}
          >
            <Icon name={copy.icon} size={22} color={color} />
            <Text style={[styles.label, { color }]}>{copy.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    backgroundColor: colors.navBar,
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
  },
  tab: {
    flex: 1,
    height: TAB_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  label: { fontSize: typeSizes.eyebrow, fontWeight: '500' },
});
