import { useState, useRef } from "react";
import {
  View, Text, TextInput, TouchableOpacity, ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { api } from "@/lib/api";
import { saveToken } from "@/lib/storage";
import { useAuth } from "@/lib/AuthContext";

export default function LoginScreen() {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { setUser } = useAuth();
  const inputRef = useRef<TextInput>(null);

  async function handleLogin() {
    if (pin.length < 4) return;
    setError("");
    setLoading(true);
    try {
      const { session_token } = await api.pinLogin(pin);
      await saveToken(session_token);
      setUser({ name: "Local", email: "local" });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg.includes("401") ? "Incorrect PIN" : `Connection error: ${msg}`);
      setPin("");
      inputRef.current?.focus();
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-slate-950">
      <View className="flex-1 items-center justify-center px-6">
        <View className="w-full max-w-xs bg-slate-900 border border-slate-800 rounded-2xl p-8 items-center shadow-2xl">

          {/* Icon */}
          <View className={`w-14 h-14 rounded-full border items-center justify-center mb-5 ${error ? "bg-red-900/30 border-red-500/50" : "bg-indigo-500/20 border-indigo-500/30"}`}>
            <Text className={`text-2xl ${error ? "text-red-400" : "text-indigo-400"}`}>🔒</Text>
          </View>

          <Text className="text-white text-lg font-semibold mb-1">Wealth Dashboard</Text>
          <Text className="text-slate-400 text-sm mb-6">Enter your 4-digit PIN</Text>

          <TextInput
            ref={inputRef}
            className={`w-full text-center text-2xl tracking-widest rounded-xl border-2 bg-slate-800 text-white py-4 ${error ? "border-red-500" : "border-slate-700"}`}
            value={pin}
            onChangeText={t => { setPin(t.replace(/\D/g, "").slice(0, 4)); setError(""); }}
            keyboardType="number-pad"
            maxLength={4}
            secureTextEntry
            autoFocus
            placeholder="••••"
            placeholderTextColor="#475569"
            onSubmitEditing={handleLogin}
            returnKeyType="done"
          />

          <TouchableOpacity
            onPress={handleLogin}
            disabled={loading || pin.length < 4}
            className="mt-4 w-full py-3 rounded-xl bg-indigo-600 items-center active:opacity-80 disabled:opacity-40"
          >
            {loading
              ? <ActivityIndicator color="white" />
              : <Text className="text-white font-medium">Unlock</Text>
            }
          </TouchableOpacity>

          {error ? (
            <Text className="text-red-400 text-sm mt-4">{error}</Text>
          ) : null}
        </View>
      </View>
    </SafeAreaView>
  );
}
