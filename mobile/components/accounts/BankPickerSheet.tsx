/**
 * BankPickerSheet — native bottom sheet for selecting a bank to connect via TrueLayer OAuth.
 * Uses expo-web-browser (openBrowserAsync) for the OAuth flow, matching the porting spec.
 */

import React, { useState, useEffect, useRef } from "react";
import {
  View, Text, Pressable, StyleSheet, TextInput,
  FlatList, Image, ActivityIndicator,
} from "react-native";
import { X, Search, ChevronRight } from "lucide-react-native";
import { openBrowserAsync } from "expo-web-browser";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { tw, HAIRLINE } from "@/lib/tw";

const EXT = { rose500: "#f43f5e" } as const;
import { accountsApi } from "@/lib/api/accounts";

interface Bank {
  id: string;
  name: string;
  logo: string;
}

interface BankPickerSheetProps {
  visible: boolean;
  onClose: () => void;
  dark: boolean;
  /** Called immediately before the OAuth browser opens */
  onConnecting?: () => void;
}

export function BankPickerSheet({ visible, onClose, dark, onConnecting }: BankPickerSheetProps) {
  const ink = dark ? tw.color.slate100 : tw.color.slate900;
  const muted = tw.color.slate400;
  const inputBg = dark ? tw.color.slate700 : tw.color.slate100;

  const [banks, setBanks] = useState<Bank[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [connecting, setConnecting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setLoading(true);
    setError(null);
    accountsApi.truelayerProviders()
      .then(setBanks)
      .catch(() => setError("Failed to load banks. Please try again."))
      .finally(() => setLoading(false));
  }, [visible]);

  const filtered = query.trim()
    ? banks.filter(b => b.name.toLowerCase().includes(query.toLowerCase()))
    : banks;

  async function handleSelect(bank: Bank) {
    if (connecting !== null) return;
    setConnecting(bank.id);
    setError(null);
    try {
      const { auth_url } = await accountsApi.connectLink(bank.id);
      onConnecting?.();
      onClose();
      await openBrowserAsync(auth_url, {
        showTitle: false,
      });
    } catch (err) {
      const msg =
        err instanceof Error && err.message.startsWith("402")
          ? "Free plan allows 2 connected banks. Upgrade to Pro for unlimited connections."
          : "Failed to connect. Please try again.";
      setError(msg);
      setConnecting(null);
    }
  }

  function handleClose() {
    setQuery("");
    setConnecting(null);
    setError(null);
    onClose();
  }

  return (
    <BottomSheet visible={visible} onClose={handleClose}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={[styles.title, { color: ink }]}>Add a Bank</Text>
          <Text style={[styles.subtitle, { color: muted }]}>
            Secure open banking · Powered by TrueLayer
          </Text>
        </View>
        <Pressable
          onPress={handleClose}
          style={({ pressed }) => [styles.closeBtn, { opacity: pressed ? 0.6 : 1, backgroundColor: dark ? tw.color.slate700 : tw.color.slate100 }]}
          accessibilityLabel="Close"
        >
          <X size={15} color={muted} />
        </Pressable>
      </View>

      {/* Search */}
      <View style={[styles.searchBar, { backgroundColor: inputBg }]}>
        <Search size={15} color={muted} />
        <TextInput
          style={[styles.searchInput, { color: ink }]}
          placeholder="Search your bank…"
          placeholderTextColor={muted}
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
        />
        {query.length > 0 && (
          <Pressable onPress={() => setQuery("")}>
            <X size={13} color={muted} />
          </Pressable>
        )}
      </View>

      {error && (
        <Text style={styles.errorText}>{error}</Text>
      )}

      {/* Bank list */}
      {loading ? (
        <View style={styles.loader}>
          <ActivityIndicator color={tw.color.indigo500} size="large" />
        </View>
      ) : filtered.length === 0 ? (
        <View style={styles.loader}>
          <Text style={[styles.emptyText, { color: muted }]}>
            {query ? `No banks matching "${query}"` : "No banks available"}
          </Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={b => b.id}
          style={styles.list}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item: bank }) => (
            <Pressable
              onPress={() => handleSelect(bank)}
              disabled={connecting !== null}
              style={({ pressed }) => [
                styles.bankRow,
                { opacity: connecting !== null ? 0.5 : pressed ? 0.7 : 1 },
                { backgroundColor: pressed ? (dark ? tw.color.slate700 : tw.color.slate50) : "transparent" },
              ]}
            >
              {/* Logo */}
              <View style={[styles.logoBox, { borderColor: dark ? tw.color.cardBorderDark : tw.color.cardBorderLight }]}>
                {bank.logo ? (
                  <Image source={{ uri: bank.logo }} style={styles.logo} />
                ) : (
                  <Text style={styles.logoInitial}>{bank.name[0]}</Text>
                )}
              </View>

              {/* Name */}
              <Text style={[styles.bankName, { color: ink }]} numberOfLines={1}>
                {bank.name}
              </Text>

              {/* Indicator */}
              {connecting === bank.id ? (
                <ActivityIndicator size="small" color={tw.color.indigo500} />
              ) : (
                <ChevronRight size={16} color={muted} />
              )}
            </Pressable>
          )}
        />
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    paddingHorizontal: tw.space[1],
    paddingBottom: tw.space[4],
  },
  title: {
    ...tw.text.base,
    fontWeight: tw.weight.bold,
  },
  subtitle: {
    ...tw.text.xs,
    marginTop: 2,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: tw.radius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: tw.space[2],
    borderRadius: tw.radius["2xl"],
    paddingHorizontal: tw.space[3],
    paddingVertical: tw.space[2.5],
    marginHorizontal: tw.space[1],
    marginBottom: tw.space[2],
  },
  searchInput: {
    flex: 1,
    ...tw.text.sm,
    padding: 0,
  },
  errorText: {
    color: EXT.rose500,
    ...tw.text.xs,
    paddingHorizontal: tw.space[1],
    marginBottom: tw.space[2],
  },
  loader: {
    paddingVertical: tw.space[10],
    alignItems: "center",
  },
  emptyText: {
    ...tw.text.sm,
    textAlign: "center",
  },
  list: {
    maxHeight: 360,
    marginHorizontal: tw.space[1],
  },
  bankRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: tw.space[3],
    paddingHorizontal: tw.space[3],
    paddingVertical: tw.space[3],
    borderRadius: tw.radius["2xl"],
  },
  logoBox: {
    width: 40,
    height: 40,
    borderRadius: tw.radius.xl,
    borderWidth: HAIRLINE,
    backgroundColor: tw.color.white,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    flexShrink: 0,
  },
  logo: {
    width: 32,
    height: 32,
    resizeMode: "contain",
  },
  logoInitial: {
    ...tw.text.sm,
    fontWeight: tw.weight.bold,
    color: tw.color.indigo500,
  },
  bankName: {
    flex: 1,
    ...tw.text.sm,
    fontWeight: tw.weight.medium,
  },
});
