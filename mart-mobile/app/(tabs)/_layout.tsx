import { View, StyleSheet, Platform } from 'react-native';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCartStore } from '@/store/cartStore';
import { useThemeColors } from '@/constants/theme';

type IoniconsName = React.ComponentProps<typeof Ionicons>['name'];

const TAB_ICONS: Record<string, { active: IoniconsName; inactive: IoniconsName }> = {
  index:      { active: 'home',    inactive: 'home-outline' },
  categories: { active: 'grid',    inactive: 'grid-outline' },
  orders:     { active: 'receipt', inactive: 'receipt-outline' },
  profile:    { active: 'person',  inactive: 'person-outline' },
};

export default function TabsLayout() {
  const insets      = useSafeAreaInsets();
  const bottomPad   = Math.max(insets.bottom, 8);
  const totalItems  = useCartStore(s => s.totalItems);
  const colors      = useThemeColors();

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor:   colors.primary,
          tabBarInactiveTintColor: colors.gray400,
          tabBarStyle: {
            backgroundColor: colors.surface,
            borderTopWidth: 1,
            borderTopColor: colors.gray100,
            paddingTop: 8,
            paddingBottom: bottomPad,
            height: 56 + bottomPad,
            elevation: 0,
            shadowOpacity: 0,
          },
          tabBarLabelStyle: {
            fontSize: 11,
            fontFamily: 'Inter-Medium',
            marginTop: 2,
          },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: 'Home',
            tabBarIcon: ({ color, focused }) => (
              <Ionicons
                name={focused ? TAB_ICONS.index.active : TAB_ICONS.index.inactive}
                size={focused ? 26 : 23}
                color={color}
              />
            ),
          }}
        />
        <Tabs.Screen
          name="categories"
          options={{
            title: 'Categories',
            tabBarIcon: ({ color, focused }) => (
              <Ionicons
                name={focused ? TAB_ICONS.categories.active : TAB_ICONS.categories.inactive}
                size={focused ? 26 : 23}
                color={color}
              />
            ),
          }}
        />
        <Tabs.Screen
          name="orders"
          options={{
            title: 'Orders',
            tabBarIcon: ({ color, focused }) => (
              <Ionicons
                name={focused ? TAB_ICONS.orders.active : TAB_ICONS.orders.inactive}
                size={focused ? 26 : 23}
                color={color}
              />
            ),
          }}
        />
        <Tabs.Screen
          name="profile"
          options={{
            title: 'Profile',
            tabBarIcon: ({ color, focused }) => (
              <Ionicons
                name={focused ? TAB_ICONS.profile.active : TAB_ICONS.profile.inactive}
                size={focused ? 26 : 23}
                color={color}
              />
            ),
          }}
        />
      </Tabs>
    </View>
  );
}
