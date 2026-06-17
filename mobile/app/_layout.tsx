import "../global.css";

import { useEffect, useState } from "react";
import { Stack, useRouter, useSegments } from "expo-router";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { getToken, deleteToken } from "@/lib/storage";
import { api } from "@/lib/api";
import { View, ActivityIndicator } from "react-native";

interface AuthUser {
  name: string;
  email: string;
}

export default function RootLayout() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    checkAuth();
  }, []);

  useEffect(() => {
    if (loading) return;
    const inAuth = segments[0] === "(auth)";
    if (!user && !inAuth) {
      router.replace("/(auth)/login");
    } else if (user && inAuth) {
      router.replace("/(tabs)");
    }
  }, [user, loading, segments]);

  async function checkAuth() {
    try {
      const token = await getToken();
      if (!token) { setLoading(false); return; }
      const info = await api.validateSession();
      if (info.valid) setUser({ name: info.name, email: info.email });
      else await deleteToken();
    } catch {
      await deleteToken();
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <SafeAreaProvider>
        <View className="flex-1 items-center justify-center bg-[#b91c1c]">
          <ActivityIndicator color="white" size="large" />
        </View>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(tabs)" />
      </Stack>
    </SafeAreaProvider>
  );
}
