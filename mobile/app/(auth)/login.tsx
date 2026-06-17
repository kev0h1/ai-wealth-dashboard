import { useState } from "react";
import {
  View, Text, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform, ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { api } from "@/lib/api";
import { saveToken } from "@/lib/storage";

export default function LoginScreen() {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleLogin() {
    if (pin.length < 4) { setError("Enter your PIN"); return; }
    setError("");
    setLoading(true);
    try {
      const { session_token } = await api.pinLogin(pin);
      await saveToken(session_token);
      router.replace("/(tabs)");
    } catch {
      setError("Incorrect PIN. Try again.");
      setPin("");
    } finally {
      setLoading(false);
    }
  }

  function handleDigit(d: string) {
    if (pin.length < 8) setPin(p => p + d);
  }

  function handleDelete() {
    setPin(p => p.slice(0, -1));
  }

  const digits = ["1","2","3","4","5","6","7","8","9","","0","⌫"];

  return (
    <SafeAreaView className="flex-1 bg-[#b91c1c]">
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        className="flex-1"
      >
        <View className="flex-1 items-center justify-center px-8">
          {/* Logo area */}
          <View className="mb-12 items-center">
            <Text className="text-white text-4xl font-bold tracking-tight">Wealth</Text>
            <Text className="text-white/70 text-sm mt-1">Your financial dashboard</Text>
          </View>

          {/* PIN dots */}
          <View className="flex-row gap-4 mb-10">
            {Array.from({ length: 6 }).map((_, i) => (
              <View
                key={i}
                className={`w-4 h-4 rounded-full border-2 border-white/60 ${i < pin.length ? "bg-white" : "bg-transparent"}`}
              />
            ))}
          </View>

          {error ? (
            <Text className="text-white/90 text-sm mb-6 bg-white/20 px-4 py-2 rounded-xl">
              {error}
            </Text>
          ) : (
            <Text className="text-white/60 text-sm mb-6">Enter your PIN</Text>
          )}

          {/* Keypad */}
          <View className="w-full max-w-xs">
            <View className="flex-row flex-wrap justify-center gap-4">
              {digits.map((d, i) => {
                if (d === "") return <View key={i} className="w-20 h-16" />;
                return (
                  <TouchableOpacity
                    key={i}
                    onPress={() => d === "⌫" ? handleDelete() : handleDigit(d)}
                    className="w-20 h-16 rounded-2xl bg-white/20 active:bg-white/40 items-center justify-center"
                  >
                    <Text className="text-white text-2xl font-semibold">{d}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* Login button */}
          <TouchableOpacity
            onPress={handleLogin}
            disabled={loading || pin.length < 4}
            className="mt-8 w-full max-w-xs py-4 rounded-2xl bg-white items-center active:opacity-80 disabled:opacity-40"
          >
            {loading ? (
              <ActivityIndicator color="#b91c1c" />
            ) : (
              <Text className="text-[#b91c1c] text-base font-bold">Unlock</Text>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
