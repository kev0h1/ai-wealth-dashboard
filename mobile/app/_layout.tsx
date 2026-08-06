import { SafeAreaProvider } from "react-native-safe-area-context";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { AuthProvider } from "@/lib/AuthContext";
import { ThemeProvider } from "@/lib/ThemeContext";
import { ColourProvider } from "@/lib/ColourContext";
import { PreferencesProvider } from "@/lib/PreferencesContext";
import { CategoriesProvider } from "@/lib/CategoriesContext";

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <ThemeProvider>
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
        </ThemeProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
