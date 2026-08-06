import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
} from "react-native";
import { api } from "@/lib/api";
import { useTheme } from "@/lib/ThemeContext";
import { tw } from "@/lib/tw";

interface ProfileStepProps {
  onNext: () => void;
  defaultName?: string;
  onNameSaved?: (name: string) => void;
}

export function ProfileStep({ onNext, defaultName = "", onNameSaved }: ProfileStepProps) {
  const { dark } = useTheme();

  const parts = defaultName.split(" ");
  const [firstName, setFirstName] = useState(parts[0] ?? "");
  const [lastName, setLastName] = useState(parts.slice(1).join(" ") ?? "");
  const [postcode, setPostcode] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [firstFocused, setFirstFocused] = useState(false);
  const [lastFocused, setLastFocused] = useState(false);
  const [postFocused, setPostFocused] = useState(false);
  const [ctaPressed, setCtaPressed] = useState(false);

  async function saveProfile() {
    const first = firstName.trim();
    const last = lastName.trim();
    if (!first) {
      setError("Please enter your first name.");
      return;
    }
    if (!last) {
      setError("Please enter your last name.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const fullName = `${first} ${last}`;
      await api.updateProfile(fullName, postcode.trim() || undefined, false);
      onNameSaved?.(fullName);
      onNext();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Couldn't save. Please try again."
      );
    } finally {
      setSaving(false);
    }
  }

  const cardBg = dark ? tw.color.slate800 : tw.color.white;
  const inputBg = dark ? tw.color.slate900 : tw.color.white;
  const labelColor = dark ? tw.color.slate400 : tw.color.slate500;
  const inputColor = dark ? tw.color.slate100 : tw.color.slate900;
  const borderDefault = dark ? tw.color.slate700 : tw.color.slate200;

  return (
    <View style={styles.container}>
      <Text
        style={[
          styles.heading,
          { color: dark ? tw.color.slate100 : tw.color.slate900 },
        ]}
      >
        What's your name?
      </Text>
      <Text
        style={[
          styles.subheading,
          { color: dark ? tw.color.slate400 : tw.color.slate500 },
        ]}
      >
        We use your name to recognise transfers between your own accounts.
      </Text>

      <View
        style={[
          styles.card,
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
        {/* Name fields row */}
        <View style={styles.nameRow}>
          <View style={{ flex: 1 }}>
            <Text
              style={[
                styles.label,
                { color: labelColor, letterSpacing: tw.tracking(0.05, 12) },
              ]}
            >
              First name
            </Text>
            <TextInput
              value={firstName}
              onChangeText={setFirstName}
              onFocus={() => setFirstFocused(true)}
              onBlur={() => setFirstFocused(false)}
              maxLength={40}
              placeholder="Kevin"
              returnKeyType="next"
              style={[
                styles.input,
                {
                  backgroundColor: inputBg,
                  color: inputColor,
                  borderColor: firstFocused ? tw.color.indigo500 : borderDefault,
                },
              ]}
              placeholderTextColor={dark ? tw.color.slate600 : tw.color.slate400}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text
              style={[
                styles.label,
                { color: labelColor, letterSpacing: tw.tracking(0.05, 12) },
              ]}
            >
              Last name
            </Text>
            <TextInput
              value={lastName}
              onChangeText={setLastName}
              onFocus={() => setLastFocused(true)}
              onBlur={() => setLastFocused(false)}
              maxLength={40}
              placeholder="Maingi"
              returnKeyType="next"
              style={[
                styles.input,
                {
                  backgroundColor: inputBg,
                  color: inputColor,
                  borderColor: lastFocused ? tw.color.indigo500 : borderDefault,
                },
              ]}
              placeholderTextColor={dark ? tw.color.slate600 : tw.color.slate400}
            />
          </View>
        </View>

        {/* Postcode field */}
        <View>
          <View style={styles.postcodeLabel}>
            <Text
              style={[
                styles.label,
                { color: labelColor, letterSpacing: tw.tracking(0.05, 12) },
              ]}
            >
              Postcode{" "}
            </Text>
            <Text style={[styles.label, { color: dark ? tw.color.slate600 : tw.color.slate400, fontWeight: "400", textTransform: "none", letterSpacing: 0 }]}>
              (optional)
            </Text>
          </View>
          <TextInput
            value={postcode}
            onChangeText={(t) => setPostcode(t.toUpperCase())}
            onFocus={() => setPostFocused(true)}
            onBlur={() => setPostFocused(false)}
            autoCapitalize="characters"
            maxLength={10}
            placeholder="e.g. SW1A 1AA"
            style={[
              styles.input,
              {
                backgroundColor: inputBg,
                color: inputColor,
                borderColor: postFocused ? tw.color.indigo500 : borderDefault,
              },
            ]}
            placeholderTextColor={dark ? tw.color.slate600 : tw.color.slate400}
          />
          <Text
            style={[
              styles.helper,
              { color: dark ? tw.color.slate500 : tw.color.slate400 },
            ]}
          >
            Used to find cheaper fuel near you.
          </Text>
        </View>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Pressable
        onPress={saveProfile}
        onPressIn={() => setCtaPressed(true)}
        onPressOut={() => setCtaPressed(false)}
        disabled={saving}
        style={[
          styles.cta,
          {
            opacity: saving ? 0.5 : 1,
            transform: [{ scale: ctaPressed ? 0.97 : 1 }],
          },
        ]}
      >
        <Text style={styles.ctaText}>{saving ? "Saving…" : "Continue"}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: "100%",
  },
  heading: {
    fontSize: 20,
    fontWeight: "700",
    marginBottom: 8,
  },
  subheading: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 24,
  },
  card: {
    borderRadius: 24,
    padding: 24,
    gap: 16,
    marginBottom: 12,
  },
  nameRow: {
    flexDirection: "row",
    gap: 12,
  },
  label: {
    fontSize: 12,
    fontWeight: "600",
    marginBottom: 6,
    textTransform: "uppercase",
  },
  input: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1.5,
    fontSize: 14,
  },
  postcodeLabel: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 6,
  },
  helper: {
    fontSize: 12,
    marginTop: 6,
  },
  error: {
    fontSize: 12,
    color: "#f43f5e",
    marginBottom: 8,
  },
  cta: {
    borderRadius: 16,
    paddingVertical: 14,
    backgroundColor: tw.color.indigo600,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
  ctaText: {
    fontSize: 14,
    fontWeight: "600",
    color: "white",
  },
});
