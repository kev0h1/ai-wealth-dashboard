import React, { useEffect, useState } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { ShieldCheck } from "lucide-react-native";
import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";
import { useTheme } from "@/lib/ThemeContext";
import { tw } from "@/lib/tw";

interface SecureStepProps {
  onFinish: (biometric: boolean) => void;
}

export function SecureStep({ onFinish }: SecureStepProps) {
  const { dark } = useTheme();
  const [enablePressed, setEnablePressed] = useState(false);
  const [laterPressed, setLaterPressed] = useState(false);

  useEffect(() => {
    (async () => {
      const [hasHw, enrolled] = await Promise.all([
        LocalAuthentication.hasHardwareAsync(),
        LocalAuthentication.isEnrolledAsync(),
      ]);
      if (!hasHw || !enrolled) {
        onFinish(false);
      }
    })();
  }, []);

  async function enableBiometric() {
    await SecureStore.setItemAsync("biometric_lock", "1");
    onFinish(true);
  }

  async function skipBiometric() {
    await SecureStore.setItemAsync("biometric_lock", "0");
    onFinish(false);
  }

  return (
    <View style={styles.container}>
      <View
        style={[
          styles.iconContainer,
          {
            backgroundColor: dark
              ? "rgba(79,70,229,0.3)"
              : tw.color.indigo50,
          },
        ]}
      >
        <ShieldCheck size={28} color={tw.color.indigo500} />
      </View>

      <Text
        style={[
          styles.heading,
          { color: dark ? tw.color.slate100 : tw.color.slate900 },
        ]}
      >
        Protect your dashboard
      </Text>
      <Text
        style={[
          styles.subheading,
          { color: dark ? tw.color.slate400 : tw.color.slate500 },
        ]}
      >
        Your finances live here. Require your fingerprint or face every time the
        app opens — you can change this any time in Settings.
      </Text>

      <Pressable
        onPress={enableBiometric}
        onPressIn={() => setEnablePressed(true)}
        onPressOut={() => setEnablePressed(false)}
        style={[
          styles.cta,
          { transform: [{ scale: enablePressed ? 0.97 : 1 }] },
        ]}
      >
        <Text style={styles.ctaText}>ENABLE BIOMETRIC UNLOCK</Text>
      </Pressable>

      <Pressable
        onPress={skipBiometric}
        onPressIn={() => setLaterPressed(true)}
        onPressOut={() => setLaterPressed(false)}
        style={[styles.later, { opacity: laterPressed ? 0.7 : 1 }]}
      >
        <Text
          style={[
            styles.laterText,
            { color: dark ? tw.color.slate500 : tw.color.slate400 },
          ]}
        >
          Maybe later
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: "100%",
    alignItems: "center",
  },
  iconContainer: {
    width: 64,
    height: 64,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  heading: {
    fontSize: 20,
    fontWeight: "700",
    marginBottom: 8,
    textAlign: "center",
  },
  subheading: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
    marginBottom: 32,
  },
  cta: {
    width: "100%",
    borderRadius: 16,
    paddingVertical: 14,
    backgroundColor: tw.color.indigo600,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  ctaText: {
    fontSize: 14,
    fontWeight: "600",
    color: "white",
  },
  later: {
    paddingVertical: 10,
    alignItems: "center",
  },
  laterText: {
    fontSize: 14,
    textAlign: "center",
  },
});
