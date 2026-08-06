import React, { useCallback, useState } from "react";
import { View, Text, Pressable, StyleSheet, Linking } from "react-native";
import { AlertTriangle } from "lucide-react-native";
import { tw } from "@/lib/tw";
import type { Account } from "@/lib/api";
import { accountsApi } from "@/lib/api/accounts";

interface Props {
  accounts: Account[];
  reauthIds: string[];
  dark: boolean;
}

function needsReauth(account: Account): boolean {
  return account.status === "expired" || account.status === "reconnect_required";
}

function ProviderBanner({
  provider,
  providerId,
  dark,
}: {
  provider: string;
  providerId?: string;
  dark: boolean;
}) {
  const [busy, setBusy] = useState(false);

  const handleReconnect = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const { auth_url } = await accountsApi.connectLink(providerId);
      await Linking.openURL(auth_url);
    } catch {
      // non-fatal — user stays on screen
    } finally {
      setBusy(false);
    }
  }, [busy, providerId]);

  const inkColor = dark ? tw.color.amber200 : tw.color.amber800;
  const subColor = dark ? tw.color.amber400 : tw.color.amber600;
  const bgColor = dark ? tw.color.amber900 : tw.color.amber50;
  const borderColor = dark ? tw.color.amber700 : tw.color.amber200;

  return (
    <View
      style={[styles.banner, { backgroundColor: bgColor, borderColor }]}
    >
      <AlertTriangle size={15} color={tw.color.amber500} />
      <View style={styles.bannerText}>
        <Text
          style={[styles.bannerTitle, { color: inkColor }]}
          numberOfLines={1}
        >
          {provider} needs reconnecting
        </Text>
        <Text style={[styles.bannerSub, { color: subColor }]}>
          Transactions have stopped syncing.
        </Text>
      </View>
      <Pressable
        onPress={handleReconnect}
        disabled={busy}
        style={({ pressed }) => [
          styles.reconnectBtn,
          { opacity: pressed || busy ? 0.7 : 1, transform: [{ scale: pressed ? 0.95 : 1 }] },
        ]}
      >
        <Text style={styles.reconnectBtnText}>Reconnect</Text>
      </Pressable>
    </View>
  );
}

export function ReauthBanners({ accounts, reauthIds, dark }: Props) {
  // Deduplicate by provider (one banner per provider, matching web behaviour)
  const seen = new Set<string>();
  const expiredProviders: { provider: string; provider_id?: string }[] = [];

  for (const a of accounts) {
    if (
      (reauthIds.includes(a.id) || needsReauth(a)) &&
      !seen.has(a.provider)
    ) {
      seen.add(a.provider);
      expiredProviders.push({ provider: a.provider, provider_id: a.provider_id });
    }
  }

  if (expiredProviders.length === 0) return null;

  return (
    <View style={styles.stack}>
      {expiredProviders.map(({ provider, provider_id }) => (
        <ProviderBanner
          key={provider}
          provider={provider}
          providerId={provider_id}
          dark={dark}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: {
    gap: tw.space[2],
  },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: tw.space[3],
    borderRadius: tw.radius["2xl"],
    paddingHorizontal: tw.space[4],
    paddingVertical: tw.space[3],
    borderWidth: 1,
  },
  bannerText: {
    flex: 1,
    gap: 2,
  },
  bannerTitle: {
    ...tw.text.sm,
    fontWeight: tw.weight.semibold,
  },
  bannerSub: {
    fontSize: 11,
    lineHeight: 16,
  },
  reconnectBtn: {
    backgroundColor: tw.color.amber500,
    paddingHorizontal: tw.space[3],
    paddingVertical: tw.space[1],
    borderRadius: tw.radius.lg,
    flexShrink: 0,
  },
  reconnectBtnText: {
    color: tw.color.white,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: tw.weight.semibold,
  },
});
