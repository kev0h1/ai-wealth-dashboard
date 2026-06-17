import { Tabs } from "expo-router";
import { Platform, Text, ColorValue } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

// Simple SVG-free icons using text — replace with @expo/vector-icons if desired
function TabIcon({ label, focused }: { label: string; focused: boolean }) {
  const icons: Record<string, string> = {
    Home: "⌂",
    Spend: "₤",
    Debt: "↘",
    Budget: "▤",
    Accounts: "🏦",
  };
  return null; // icon rendered via title label below
}

const BRAND = "#b91c1c";
const INACTIVE = "#94a3b8";

export default function TabLayout() {
  const insets = useSafeAreaInsets();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: BRAND,
        tabBarInactiveTintColor: INACTIVE,
        tabBarStyle: {
          backgroundColor: "#ffffff",
          borderTopColor: "#f1f5f9",
          borderTopWidth: 1,
          paddingBottom: Platform.OS === "ios" ? insets.bottom : 8,
          paddingTop: 8,
          height: Platform.OS === "ios" ? 84 + insets.bottom : 64,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: "600",
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          tabBarIcon: ({ color }) => (
            <TabItemIcon char="⌂" color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="spend"
        options={{
          title: "Spend",
          tabBarIcon: ({ color }) => (
            <TabItemIcon char="≋" color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="debt"
        options={{
          title: "Debt",
          tabBarIcon: ({ color }) => (
            <TabItemIcon char="↘" color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="budget"
        options={{
          title: "Budget",
          tabBarIcon: ({ color }) => (
            <TabItemIcon char="▤" color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="accounts"
        options={{
          title: "Accounts",
          tabBarIcon: ({ color }) => (
            <TabItemIcon char="◈" color={color} />
          ),
        }}
      />
    </Tabs>
  );
}

function TabItemIcon({ char, color }: { char: string; color: ColorValue }) {
  return <Text style={{ fontSize: 20, color, lineHeight: 24 }}>{char}</Text>;
}
