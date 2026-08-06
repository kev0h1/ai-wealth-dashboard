import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Svg, { Polyline } from "react-native-svg";
import { Building2, Wallet, Sparkles, ChevronRight } from "lucide-react-native";
import { useTheme } from "@/lib/ThemeContext";
import { tw } from "@/lib/tw";

interface WelcomeStepProps {
  onNext: () => void;
}

const FEATURE_CARDS = [
  {
    Icon: Building2,
    bgLight: "#eff6ff",
    bgDark: "rgba(29,78,216,0.3)",
    iconColorLight: "#2563eb",
    iconColorDark: "#93c5fd",
    text: "Connect all your banks automatically via open banking",
  },
  {
    Icon: Wallet,
    bgLight: "#ecfdf5",
    bgDark: "rgba(6,78,59,0.3)",
    iconColorLight: "#059669",
    iconColorDark: "#6ee7b7",
    text: "Track spending and set budgets that actually stick",
  },
  {
    Icon: Sparkles,
    bgLight: "#f5f3ff",
    bgDark: "rgba(91,33,182,0.3)",
    iconColorLight: "#7c3aed",
    iconColorDark: "#a78bfa",
    text: "Get AI-powered insights to save more money",
  },
];

export function WelcomeStep({ onNext }: WelcomeStepProps) {
  const { dark } = useTheme();
  const [pressed, setPressed] = React.useState(false);

  return (
    <View style={styles.container}>
      {/* Hero icon */}
      <View style={styles.heroWrapper}>
        <LinearGradient
          colors={["#4f46e5", "#7c3aed"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.heroGradient}
        >
          <Svg width={40} height={40} viewBox="0 0 24 24" fill="none">
            <Polyline
              points="23 6 13.5 15.5 8.5 10.5 1 18"
              stroke="white"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <Polyline
              points="17 6 23 6 23 12"
              stroke="white"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Svg>
        </LinearGradient>
      </View>

      {/* Heading block */}
      <View style={styles.headingBlock}>
        <Text
          style={[
            styles.title,
            {
              color: dark ? tw.color.slate100 : tw.color.slate900,
              letterSpacing: tw.tracking(tw.trackingEm.tight, 30),
            },
          ]}
        >
          Welcome to Wealth
        </Text>
        <Text
          style={[
            styles.subtitle,
            { color: dark ? tw.color.slate400 : tw.color.slate500 },
          ]}
        >
          Your money, all in one place. Set up takes 2 minutes.
        </Text>
      </View>

      {/* Feature cards */}
      <View style={styles.cards}>
        {FEATURE_CARDS.map(({ Icon, bgLight, bgDark, iconColorLight, iconColorDark, text }) => (
          <View
            key={text}
            style={[
              styles.card,
              { backgroundColor: dark ? tw.color.slate800 : tw.color.white },
            ]}
          >
            <View
              style={[
                styles.iconBadge,
                { backgroundColor: dark ? bgDark : bgLight },
              ]}
            >
              <Icon size={18} color={dark ? iconColorDark : iconColorLight} />
            </View>
            <Text
              style={[
                styles.cardText,
                { color: dark ? tw.color.slate300 : tw.color.slate700 },
              ]}
            >
              {text}
            </Text>
          </View>
        ))}
      </View>

      {/* CTA */}
      <Pressable
        onPress={onNext}
        onPressIn={() => setPressed(true)}
        onPressOut={() => setPressed(false)}
        style={[styles.cta, { transform: [{ scale: pressed ? 0.97 : 1 }] }]}
      >
        <Text style={styles.ctaText}>Get started</Text>
        <ChevronRight size={16} color="white" />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
  },
  heroWrapper: {
    marginBottom: 24,
  },
  heroGradient: {
    width: 80,
    height: 80,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  headingBlock: {
    alignItems: "center",
    marginBottom: 40,
  },
  title: {
    fontSize: 30,
    fontWeight: "700",
    textAlign: "center",
  },
  subtitle: {
    fontSize: 14,
    marginTop: 8,
    lineHeight: 20,
    textAlign: "center",
  },
  cards: {
    width: "100%",
    gap: 12,
    marginBottom: 40,
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowOffset: { width: 0, height: 1 },
    shadowRadius: 2,
    elevation: 1,
  },
  iconBadge: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  cardText: {
    fontSize: 14,
    lineHeight: 20,
    flex: 1,
  },
  cta: {
    width: "100%",
    borderRadius: 16,
    paddingVertical: 14,
    backgroundColor: tw.color.indigo600,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  ctaText: {
    fontSize: 14,
    fontWeight: "600",
    color: "white",
  },
});
