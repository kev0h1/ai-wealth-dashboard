import { useState, useEffect, useCallback } from "react";
import { Tabs } from "expo-router";
import { Home, PieChart, Target, Lightbulb, Settings } from "lucide-react-native";
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  type ColorValue,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";

const ACTIVE = "#4f46e5";
const INACTIVE = "#94a3b8";
const BG_LIGHT = "#f0f2f7";
const BG_DARK = "#0f172a";

export default function TabLayout() {
  const [unlocked, setUnlocked] = useState<boolean | null>(null);
  // Simplified: gate always renders in light mode; full dark tracking lives inside DashboardWebView
  const darkMode = false;
  const insets = useSafeAreaInsets();

  const tryUnlock = useCallback(async () => {
    try {
      const pref = await SecureStore.getItemAsync("biometric_lock");
      if (pref === "0") { setUnlocked(true); return; }
      const [hasHardware, enrolled] = await Promise.all([
        LocalAuthentication.hasHardwareAsync(),
        LocalAuthentication.isEnrolledAsync(),
      ]);
      if (!hasHardware || !enrolled) { setUnlocked(true); return; }
      const res = await LocalAuthentication.authenticateAsync({
        promptMessage: "Unlock your dashboard",
      });
      setUnlocked(res.success ? true : false);
    } catch {
      setUnlocked(true);
    }
  }, []);

  useEffect(() => { tryUnlock(); }, [tryUnlock]);

  const bgColor = darkMode ? BG_DARK : BG_LIGHT;

  if (unlocked !== true) {
    return (
      <SafeAreaView style={[styles.gate, { backgroundColor: bgColor }]}>
        {unlocked === null ? (
          <ActivityIndicator size="large" color="#4f46e5" />
        ) : (
          <View style={styles.gateContent}>
            <Text style={[styles.gateTitle, { color: darkMode ? "#e2e8f0" : "#0f172a" }]}>
              Dashboard locked
            </Text>
            <Text style={[styles.gateBody, { color: darkMode ? "#94a3b8" : "#64748b" }]}>
              Unlock with your fingerprint or face to see your finances.
            </Text>
            <TouchableOpacity onPress={tryUnlock} style={styles.unlockBtn}>
              <Text style={styles.unlockBtnText}>Unlock</Text>
            </TouchableOpacity>
          </View>
        )}
      </SafeAreaView>
    );
  }

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: ACTIVE,
        tabBarInactiveTintColor: INACTIVE,
        tabBarStyle: {
          backgroundColor: "#ffffff",
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: "#f1f5f9",
          height: 56 + insets.bottom,
          paddingBottom: Math.max(insets.bottom, 8),
          paddingTop: 8,
        },
        tabBarLabelStyle: {
          fontSize: 10,
          fontWeight: "600",
        },
        lazy: true,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          tabBarIcon: ({ color, size }: { color: ColorValue; size: number }) => (
            <Home color={color as string} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="spend"
        options={{
          title: "Spend",
          tabBarIcon: ({ color, size }: { color: ColorValue; size: number }) => (
            <PieChart color={color as string} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="budget"
        options={{
          title: "Budget",
          tabBarIcon: ({ color, size }: { color: ColorValue; size: number }) => (
            <Target color={color as string} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="insights"
        options={{
          title: "Insights",
          tabBarIcon: ({ color, size }: { color: ColorValue; size: number }) => (
            <Lightbulb color={color as string} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "Settings",
          tabBarIcon: ({ color, size }: { color: ColorValue; size: number }) => (
            <Settings color={color as string} size={size} />
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  gate: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  gateContent: {
    alignItems: "center",
    gap: 16,
    paddingHorizontal: 32,
  },
  gateTitle: {
    fontSize: 18,
    fontWeight: "700",
  },
  gateBody: {
    fontSize: 13,
    textAlign: "center",
  },
  unlockBtn: {
    backgroundColor: "#4f46e5",
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderRadius: 14,
  },
  unlockBtnText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 15,
  },
});
