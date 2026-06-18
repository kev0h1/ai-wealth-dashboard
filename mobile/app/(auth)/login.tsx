import { useEffect } from "react";
import { View, Text, TouchableOpacity, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";
import { saveToken } from "@/lib/storage";
import { useAuth } from "@/lib/AuthContext";
import { useState } from "react";

WebBrowser.maybeCompleteAuthSession();

const AUTH_URL = "https://wealth.auriqltd.co.uk/api/auth/google/mobile";

export default function LoginScreen() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const { setUser } = useAuth();

  useEffect(() => {
    const sub = Linking.addEventListener("url", handleDeepLink);
    return () => sub.remove();
  }, []);

  function handleDeepLink({ url }: { url: string }) {
    const parsed = Linking.parse(url);
    if (parsed.path !== "auth") return;

    const token = parsed.queryParams?.token as string | undefined;
    const err = parsed.queryParams?.error as string | undefined;

    if (token) {
      saveToken(token).then(() => {
        setUser({ name: "", email: "" });
      });
    } else {
      setError(err === "access_denied" ? "Access denied." : "Sign-in failed. Try again.");
      setLoading(false);
    }
  }

  async function handleGoogleSignIn() {
    setError("");
    setLoading(true);
    try {
      const result = await WebBrowser.openAuthSessionAsync(AUTH_URL, "wealthdash://auth");
      if (result.type !== "success") {
        setLoading(false);
      }
    } catch {
      setError("Could not open sign-in page.");
      setLoading(false);
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-slate-50">
      <View className="flex-1 items-center justify-center px-6">

        {/* Icon + title */}
        <View className="items-center mb-10">
          <View className="w-20 h-20 rounded-3xl bg-indigo-600 items-center justify-center mb-5 shadow-lg">
            <Text className="text-4xl">📈</Text>
          </View>
          <Text className="text-slate-900 text-3xl font-bold">Wealth Dashboard</Text>
          <Text className="text-slate-500 text-sm mt-1">Your personal AI finance tracker</Text>
        </View>

        {/* Sign-in card */}
        <View className="w-full max-w-xs bg-white rounded-2xl p-6 shadow-sm border border-slate-100">
          <Text className="text-slate-600 text-center text-sm mb-5">
            Sign in with your Google account to access your dashboard.
          </Text>

          <TouchableOpacity
            onPress={handleGoogleSignIn}
            disabled={loading}
            className="flex-row items-center justify-center border border-slate-200 rounded-xl py-3 px-4 bg-white active:bg-slate-50 disabled:opacity-60"
          >
            {loading ? (
              <ActivityIndicator color="#4285F4" />
            ) : (
              <>
                <Text className="text-lg mr-3">G</Text>
                <Text className="text-slate-700 font-medium text-base">Continue with Google</Text>
              </>
            )}
          </TouchableOpacity>

          {error ? (
            <Text className="text-red-500 text-sm text-center mt-4">{error}</Text>
          ) : null}
        </View>

        <Text className="text-slate-400 text-xs mt-8 text-center">
          Sign in to manage your personal finance dashboard.
        </Text>
      </View>
    </SafeAreaView>
  );
}
