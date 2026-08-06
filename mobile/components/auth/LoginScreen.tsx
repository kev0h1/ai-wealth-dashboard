import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  Pressable,
  ActivityIndicator,
  StyleSheet,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import Constants from "expo-constants";
import { GoogleSignin, isSuccessResponse } from "@react-native-google-signin/google-signin";
import { useAuth } from "@/lib/AuthContext";
import { useTheme } from "@/lib/ThemeContext";
import { tw } from "@/lib/tw";

const API_BASE: string =
  (Constants.expoConfig?.extra?.apiUrl as string | undefined) ??
  "https://wealth.auriqltd.co.uk/api";

export function LoginScreen() {
  const { setToken } = useAuth();
  const { dark } = useTheme();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    GoogleSignin.configure({
      webClientId: Constants.expoConfig?.extra?.googleWebClientId as string | undefined,
    });
  }, []);

  async function handleGoogleSignIn() {
    if (loading) return;
    setLoading(true);
    setError(null);

    try {
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
      await GoogleSignin.signOut(); // forces account picker
      const response = await GoogleSignin.signIn();

      if (!isSuccessResponse(response)) {
        // User cancelled — silent, back to idle
        return;
      }

      const idToken = response.data?.idToken;
      if (!idToken) {
        setError("Sign-in failed. Please try again.");
        return;
      }

      const res = await fetch(`${API_BASE}/auth/google/native`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id_token: idToken }),
      });

      if (res.status === 403) {
        setError("This Google account isn't on the access list.");
        return;
      }

      if (!res.ok) {
        setError("Sign-in failed. Please try again.");
        return;
      }

      const data = await res.json();
      if (data.session_token) {
        await setToken(data.session_token);
      } else {
        setError("Sign-in failed. Please try again.");
      }
    } catch {
      // e.g. Play Services not available, network error
      setError("Sign-in failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  const canvas = dark ? tw.color.canvasDark : tw.color.canvasLight;
  const ink = dark ? tw.color.slate100 : tw.color.slate900;
  const muted = dark ? tw.color.slate400 : tw.color.slate500;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: canvas }]}>
      <View style={styles.container}>
        {/* Hero mark — Penny gradient */}
        <View style={styles.heroWrap}>
          <LinearGradient
            colors={["#4f46e5", "#7c3aed"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.heroGradient}
          >
            {/* Minimalist "W" monogram */}
            <Text style={styles.heroLetter}>W</Text>
          </LinearGradient>
        </View>

        {/* App name + subtitle */}
        <Text style={[styles.appName, { color: ink }]}>Wealth Dashboard</Text>
        <Text style={[styles.subtitle, { color: muted }]}>
          Your money, clear and calm.
        </Text>

        {/* Spacer */}
        <View style={styles.spacer} />

        {/* Sign-in button */}
        <Pressable
          onPress={handleGoogleSignIn}
          disabled={loading}
          style={({ pressed }) => [
            styles.button,
            { opacity: loading || pressed ? 0.7 : 1 },
          ]}
        >
          {loading ? (
            <ActivityIndicator color="#ffffff" size="small" />
          ) : (
            <Text style={styles.buttonLabel}>Continue with Google</Text>
          )}
        </Pressable>

        {/* Inline error */}
        {error !== null && (
          <Text style={[styles.errorText, { color: tw.color.rose500 }]}>
            {error}
          </Text>
        )}

        {/* Bottom padding */}
        <View style={styles.bottomPad} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
  },
  container: {
    flex: 1,
    alignItems: "center",
    paddingHorizontal: tw.space[6],
  },
  heroWrap: {
    marginTop: 96,
    marginBottom: tw.space[8],
  },
  heroGradient: {
    width: 80,
    height: 80,
    borderRadius: tw.radius["2xl"],
    alignItems: "center",
    justifyContent: "center",
  },
  heroLetter: {
    fontSize: 36,
    fontWeight: "700",
    color: "#ffffff",
    letterSpacing: -1,
  },
  appName: {
    ...tw.text["2xl"],
    fontWeight: tw.weight.bold,
    letterSpacing: tw.tracking(tw.trackingEm.tight, 24),
    textAlign: "center",
    marginBottom: tw.space[2],
  },
  subtitle: {
    ...tw.text.base,
    textAlign: "center",
    marginBottom: 0,
  },
  spacer: {
    flex: 1,
  },
  button: {
    backgroundColor: tw.color.indigo600,
    borderRadius: tw.radius.xl,
    paddingVertical: tw.space[4],
    paddingHorizontal: tw.space[6],
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
    minHeight: 52,
  },
  buttonLabel: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "600",
    letterSpacing: tw.tracking(tw.trackingEm.wide, 16),
  },
  errorText: {
    ...tw.text.sm,
    textAlign: "center",
    marginTop: tw.space[3],
  },
  bottomPad: {
    height: tw.space[8],
  },
});
