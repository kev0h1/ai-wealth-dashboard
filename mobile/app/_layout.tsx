import "../global.css";

import { useEffect, useState } from "react";
import { Stack, useRouter, useSegments } from "expo-router";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { getToken, deleteToken } from "@/lib/storage";
import { api } from "@/lib/api";
import { View, ActivityIndicator } from "react-native";
import { AuthContext, AuthUser } from "@/lib/AuthContext";

function RootLayoutNav({ user, setUser }: { user: AuthUser | null; setUser: (u: AuthUser | null) => void }) {
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    const inAuth = segments[0] === "(auth)";
    if (!user && !inAuth) {
      router.replace("/(auth)/login");
    } else if (user && inAuth) {
      router.replace("/(tabs)");
    }
  }, [user, segments]);

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="(tabs)" />
    </Stack>
  );
}

export default function RootLayout() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkAuth();
  }, []);

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

  async function logout() {
    await deleteToken();
    setUser(null);
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
    <AuthContext.Provider value={{ user, setUser, logout }}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        <RootLayoutNav user={user} setUser={setUser} />
      </SafeAreaProvider>
    </AuthContext.Provider>
  );
}
