import { SafeAreaProvider } from "react-native-safe-area-context";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { ActivityIndicator, View } from "react-native";
import { AuthProvider, useAuth } from "@/lib/AuthContext";
import { ThemeProvider, useTheme } from "@/lib/ThemeContext";
import { ColourProvider } from "@/lib/ColourContext";
import { PreferencesProvider } from "@/lib/PreferencesContext";
import { CategoriesProvider } from "@/lib/CategoriesContext";
import { LoginScreen } from "@/components/auth/LoginScreen";

function AppGate() {
  const { token, isLoading } = useAuth();
  const { dark } = useTheme();

  if (isLoading) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: dark ? "#0f172a" : "#f0f2f7",
        }}
      >
        <ActivityIndicator color="#4f46e5" size="large" />
      </View>
    );
  }

  if (!token) {
    return <LoginScreen />;
  }

  return (
    <PreferencesProvider>
      <CategoriesProvider>
        <ColourProvider>
          <StatusBar style="auto" />
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="auth-complete" />
            <Stack.Screen name="web" options={{ headerShown: false }} />
            <Stack.Screen name="accounts" />
            <Stack.Screen name="month" />
            <Stack.Screen name="cards" />
            <Stack.Screen name="mirror" />
            <Stack.Screen name="debt-plan" />
            <Stack.Screen name="onboarding" />
          </Stack>
        </ColourProvider>
      </CategoriesProvider>
    </PreferencesProvider>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <ThemeProvider>
          <AppGate />
        </ThemeProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
