import React, { useState } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { Building2, Check } from "lucide-react-native";
import * as WebBrowser from "expo-web-browser";
import { onboardingApi } from "@/lib/api/onboarding";
import { useTheme } from "@/lib/ThemeContext";
import { tw } from "@/lib/tw";

interface BankStepProps {
  onNext: () => void;
}

const BADGES = [
  { badge: "🔒", text: "Read-only access" },
  { badge: "🏦", text: "Bank-grade encryption" },
  { badge: "✕", text: "Revoke anytime" },
];

export function BankStep({ onNext }: BankStepProps) {
  const { dark } = useTheme();
  const [bankAdded, setBankAdded] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [ctaPressed, setCtaPressed] = useState(false);
  const [skipPressed, setSkipPressed] = useState(false);

  async function connectBank() {
    try {
      setConnecting(true);
      const { auth_url } = await onboardingApi.connectLink();
      const result = await WebBrowser.openAuthSessionAsync(
        auth_url,
        "wealthdash://auth-complete"
      );
      if (result.type === "success" || result.type === "dismiss") {
        setBankAdded(true);
      }
    } catch {
      // silent — user can skip
    } finally {
      setConnecting(false);
    }
  }

  const cardBg = dark ? tw.color.slate800 : tw.color.white;

  return (
    <View style={styles.container}>
      {/* Bank icon */}
      <View
        style={[
          styles.iconContainer,
          {
            backgroundColor: bankAdded
              ? dark
                ? "rgba(6,78,59,0.2)"
                : tw.color.emerald50
              : dark
              ? "rgba(29,78,216,0.2)"
              : "#eff6ff",
          },
        ]}
      >
        {bankAdded ? (
          <Check size={28} color={tw.color.emerald500} strokeWidth={2.5} />
        ) : (
          <Building2 size={28} color="#3b82f6" />
        )}
      </View>

      {/* Heading */}
      <Text
        style={[
          styles.heading,
          { color: dark ? tw.color.slate100 : tw.color.slate900 },
        ]}
      >
        {bankAdded ? "Bank connected!" : "Connect your first bank"}
      </Text>

      {/* Subheading */}
      <Text
        style={[
          styles.subheading,
          { color: dark ? tw.color.slate400 : tw.color.slate500 },
        ]}
      >
        {bankAdded
          ? "Your transactions are syncing in the background."
          : "Link your account in seconds via secure open banking. Wealth can only read data — it can never move your money."}
      </Text>

      {/* Trust badges — only when not yet connected */}
      {!bankAdded && (
        <View style={styles.badges}>
          {BADGES.map(({ badge, text }) => (
            <View
              key={text}
              style={[
                styles.badgeCard,
                {
                  backgroundColor: cardBg,
                  shadowColor: "#000",
                  shadowOpacity: 0.05,
                  shadowOffset: { width: 0, height: 1 },
                  shadowRadius: 2,
                  elevation: 1,
                },
              ]}
            >
              <Text style={styles.badgeEmoji}>{badge}</Text>
              <Text
                style={[
                  styles.badgeText,
                  { color: dark ? tw.color.slate400 : tw.color.slate500 },
                ]}
              >
                {text}
              </Text>
            </View>
          ))}
        </View>
      )}

      {/* Main CTA */}
      <Pressable
        onPress={bankAdded ? onNext : connectBank}
        onPressIn={() => setCtaPressed(true)}
        onPressOut={() => setCtaPressed(false)}
        disabled={connecting}
        style={[
          styles.cta,
          {
            backgroundColor: bankAdded
              ? tw.color.emerald500
              : tw.color.indigo600,
            opacity: connecting ? 0.7 : 1,
            transform: [{ scale: ctaPressed ? 0.97 : 1 }],
          },
        ]}
      >
        <Text style={styles.ctaText}>
          {connecting ? "Connecting…" : bankAdded ? "Let's go ›" : "Connect a bank"}
        </Text>
      </Pressable>

      {/* Skip button */}
      {!bankAdded && (
        <Pressable
          onPress={onNext}
          onPressIn={() => setSkipPressed(true)}
          onPressOut={() => setSkipPressed(false)}
          style={[styles.skip, { opacity: skipPressed ? 0.7 : 1 }]}
        >
          <Text
            style={[
              styles.skipText,
              { color: dark ? tw.color.slate500 : tw.color.slate400 },
            ]}
          >
            Skip for now — I'll add banks later
          </Text>
        </Pressable>
      )}
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
    marginBottom: 24,
  },
  badges: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 24,
    width: "100%",
  },
  badgeCard: {
    flex: 1,
    borderRadius: 16,
    padding: 12,
    alignItems: "center",
  },
  badgeEmoji: {
    fontSize: 18,
    marginBottom: 4,
  },
  badgeText: {
    fontSize: 12,
    textAlign: "center",
    lineHeight: 16,
  },
  cta: {
    width: "100%",
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  ctaText: {
    fontSize: 14,
    fontWeight: "600",
    color: "white",
  },
  skip: {
    paddingVertical: 10,
    alignItems: "center",
  },
  skipText: {
    fontSize: 14,
    textAlign: "center",
  },
});
