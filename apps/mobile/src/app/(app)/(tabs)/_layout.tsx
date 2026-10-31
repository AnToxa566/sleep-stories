import { Tabs } from 'expo-router/js-tabs';
import { colors } from '../../../theme/tokens';
import { TabBar } from '../../../ui/TabBar';

// «Сегодня» and «Темы» are two tabs of one navigator with our own bar. What this buys: the bar
// is part of the layout (below the screens, in flow) and never goes away; a tab keeps its
// state and is not recreated; the pressed tab is active at once (TabBar reads state.index).
// What it costs: both screens are mounted from the start (`lazy: false`, owner's choice).
// «Темы» then reads GET /topics at startup, which creates no job (AGENTS.md architecture
// rule 10).
//
// `firstRoute`: the Android back key on «Темы» goes to «Сегодня», then leaves the app.
// `animation: 'none'`: no cross-fade between tabs (the default, set for clarity).
// freezeOnBlur is left off: a frozen tab would not show a queue change made on the other.
export default function TabsLayout() {
  return (
    <Tabs
      tabBar={(props) => <TabBar {...props} />}
      backBehavior="firstRoute"
      screenOptions={{
        headerShown: false,
        lazy: false,
        animation: 'none',
        sceneStyle: { backgroundColor: colors.base },
      }}
    >
      <Tabs.Screen name="home" />
      <Tabs.Screen name="topics" />
    </Tabs>
  );
}
