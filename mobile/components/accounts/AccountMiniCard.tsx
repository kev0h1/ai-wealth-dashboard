/**
 * AccountMiniCard — native version for the Accounts screen.
 * Renders a gradient card for a single bank account. Includes all BANK_META
 * aliases including the bare "hsbc" and "revolut" keys that AccountsGrid omits.
 *
 * READ-ONLY dependency on AccountsGrid.tsx for visual consistency; do NOT
 * edit AccountsGrid.tsx from here.
 */

import { View, Text, Pressable, Image, StyleSheet, ViewStyle } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Pin, RefreshCw } from "lucide-react-native";
import { tw } from "@/lib/tw";
import type { Account } from "@/lib/shared";
import type { TermsPill } from "@/lib/api/accounts";

// ── BANK_META: gradient colors [from, to] ────────────────────────────────────
const BANK_META: Record<string, [string, string]> = {
  BARCLAYS:     ["#00aeef", "#002d72"],
  NATWEST:      ["#5a0069", "#d9006c"],
  HSBC:         ["#db0011", "#6b0008"],
  MONZO:        ["#ff3464", "#ff6b35"],
  STARLING:     ["#6935d8", "#00d4aa"],
  LLOYDS:       ["#024731", "#006a4d"],
  AMEX:         ["#007bc1", "#003f6b"],
  REVOLUT:      ["#191c1f", "#3d4451"],
  SANTANDER:    ["#ec0000", "#8b0000"],
  HALIFAX:      ["#1c5aa0", "#003580"],
  NATIONWIDE:   ["#1a2e6b", "#3c5fa0"],
  CHASE:        ["#117aca", "#003087"],
  FIRST_DIRECT: ["#111111", "#444444"],
  TSB:          ["#006ab0", "#003f6b"],
  MONO:         ["#1a1a2e", "#16213e"],
  MPESA:        ["#4caf50", "#1b5e20"],
  EQUITY:       ["#e60000", "#8b0000"],
  KCB:          ["#006400", "#003300"],
  NCBA:         ["#00205b", "#001133"],
  STANBIC:      ["#003087", "#001f5b"],
  ABSA:         ["#dc143c", "#8b0000"],
  COOP:         ["#003087", "#1a5276"],
  DTB:          ["#1a237e", "#0d47a1"],
  STANCHART:    ["#00a0e3", "#005b9f"],
  FAMILY:       ["#ff6600", "#cc3300"],
  IMBANK:       ["#b22222", "#7b0000"],
  DEFAULT:      ["#2563eb", "#1d4ed8"],
};

// Logo domains for Google favicon service
const LOGO_DOMAINS: Record<string, string> = {
  MONZO:        "monzo.com",
  REVOLUT:      "revolut.com",
  SANTANDER:    "santander.co.uk",
  HALIFAX:      "halifax.co.uk",
  NATIONWIDE:   "nationwide.co.uk",
  CHASE:        "chase.co.uk",
  FIRST_DIRECT: "firstdirect.com",
  TSB:          "tsb.co.uk",
  HSBC:         "hsbc.co.uk",
  BARCLAYS:     "barclays.co.uk",
  NATWEST:      "natwest.com",
  STARLING:     "starlingbank.com",
  LLOYDS:       "lloydsbank.com",
  AMEX:         "americanexpress.com",
  MONO:         "mono.co",
  MPESA:        "safaricom.co.ke",
};

/**
 * Finexer stable provider_id → canonical BANK_META key.
 * NOTE: This includes bare "hsbc" and "revolut" keys which AccountsGrid omits.
 */
const FINEXER_ALIAS: Record<string, string> = {
  natwest:               "NATWEST",
  natwest_bankline:      "NATWEST",
  natwest_clearspend:    "NATWEST",
  rbs:                   "NATWEST",
  rbs_bankline:          "NATWEST",
  rbs_clearspend:        "NATWEST",
  chase_uk:              "CHASE",
  amex:                  "AMEX",
  first_direct:          "FIRST_DIRECT",
  barclays_personal:     "BARCLAYS",
  barclays:              "BARCLAYS",
  barclays_business:     "BARCLAYS",
  barclays_corporate:    "BARCLAYS",
  barclays_wealth:       "BARCLAYS",
  barclaycard_uk:        "BARCLAYS",
  barclaycard_bcp:       "BARCLAYS",
  hsbc_personal:         "HSBC",
  // ADDED: bare "hsbc" key — fixes Finexer fallback to DEFAULT gradient
  hsbc:                  "HSBC",
  hsbc_business:         "HSBC",
  hsbc_kinetic:          "HSBC",
  hsbc_net:              "HSBC",
  hsbc_ms:               "HSBC",
  monzo:                 "MONZO",
  starling:              "STARLING",
  lloyds:                "LLOYDS",
  lloyds_personal:       "LLOYDS",
  lloyds_business:       "LLOYDS",
  lloyds_commercial:     "LLOYDS",
  // ADDED: bare "revolut" key — fixes Finexer fallback to DEFAULT gradient
  revolut:               "REVOLUT",
  santander:             "SANTANDER",
  santander_business:    "SANTANDER",
  santander_corporate:   "SANTANDER",
  halifax:               "HALIFAX",
  nationwide:            "NATIONWIDE",
  tsb:                   "TSB",
};

function hexToRgb(hex: string): [number, number, number] | null {
  const h = hex.replace("#", "");
  if (h.length === 3) {
    const r = parseInt(h[0] + h[0], 16);
    const g = parseInt(h[1] + h[1], 16);
    const b = parseInt(h[2] + h[2], 16);
    if (isNaN(r) || isNaN(g) || isNaN(b)) return null;
    return [r, g, b];
  }
  if (h.length === 6) {
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    if (isNaN(r) || isNaN(g) || isNaN(b)) return null;
    return [r, g, b];
  }
  return null;
}

function darkenRgb([r, g, b]: [number, number, number], factor: number): string {
  return `rgb(${Math.round(r * factor)},${Math.round(g * factor)},${Math.round(b * factor)})`;
}

// Tokens present in the shared tw.ts but not yet in this worktree's copy
const EXT = {
  amber300: "#fcd34d",
} as const;

export function bankKey(account: Pick<Account, "provider" | "provider_id">): string {
  const pid = (account.provider_id ?? "").toLowerCase();
  if (pid && FINEXER_ALIAS[pid]) return FINEXER_ALIAS[pid];
  const norm = (account.provider ?? "").toUpperCase().replace(/[^A-Z]/g, "_");
  return norm in BANK_META ? norm : "DEFAULT";
}

export function getGradient(account: Account): [string, string] {
  const key = bankKey(account);
  if (key !== "DEFAULT" && BANK_META[key]) {
    return BANK_META[key];
  }
  if (account.bg_colors && account.bg_colors.length >= 2) {
    return [account.bg_colors[0], account.bg_colors[1]];
  }
  if (account.bg_colors && account.bg_colors.length === 1) {
    const rgb = hexToRgb(account.bg_colors[0]);
    const darker = rgb ? darkenRgb(rgb, 0.62) : account.bg_colors[0];
    return [account.bg_colors[0], darker];
  }
  return BANK_META.DEFAULT;
}

function getLogoUrl(account: Account): string | null {
  const key = bankKey(account);
  const domain = LOGO_DOMAINS[key];
  if (domain) return `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;
  if (account.logo_url) return account.logo_url;
  return null;
}

function getInitials(account: Account): string {
  const name = account.provider || account.name || "?";
  return name.slice(0, 2).toUpperCase();
}

export function isExpired(account: Account): boolean {
  return account.status === "expired" || account.status === "reconnect_required";
}

export function typeLabel(account: Account): string {
  const type = account.type.toLowerCase();
  const sub = (account.subtype ?? "").toLowerCase();
  if (type.includes("credit") || sub.includes("credit")) return "Credit";
  if (sub.includes("isa")) return "ISA";
  if (sub.includes("saving") || type.includes("saving")) return "Savings";
  return "Current";
}

export function isCreditAccount(account: Account): boolean {
  const t = (account.type ?? "").toLowerCase();
  const s = (account.subtype ?? "").toLowerCase();
  return t.includes("credit") || s.includes("credit");
}

interface AccountMiniCardProps {
  account: Account;
  hidden: boolean;
  dark: boolean;
  onPress: () => void;
  pinned?: boolean;
  onTogglePin?: () => void;
  onReconnect?: () => void;
  termsPill?: TermsPill | null;
  onTermsClick?: () => void;
  onAddRates?: () => void;
  style?: ViewStyle;
}

export function AccountMiniCard({
  account,
  hidden,
  onPress,
  pinned,
  onTogglePin,
  onReconnect,
  termsPill,
  onTermsClick,
  onAddRates,
  style,
}: AccountMiniCardProps) {
  const [from, to] = getGradient(account);
  const logoUrl = getLogoUrl(account);
  const initials = getInitials(account);
  const expired = isExpired(account);
  const label = typeLabel(account);
  const isCredit = isCreditAccount(account);

  const balanceStr = hidden
    ? "••••"
    : `${account.balance < 0 ? "-" : ""}£${Math.abs(account.balance).toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.wrapper,
        { transform: [{ scale: pressed ? 0.95 : 1 }] },
        style,
      ]}
    >
      <LinearGradient
        colors={[from, to] as [string, string]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.card}
      >
        {/* Top row: logo + type badge */}
        <View style={styles.topRow}>
          <View style={styles.logoContainer}>
            {logoUrl ? (
              <Image source={{ uri: logoUrl }} style={styles.logo} />
            ) : (
              <View style={styles.logoFallback}>
                <Text style={styles.logoInitials}>{initials}</Text>
              </View>
            )}
          </View>
          <View style={styles.typeBadge}>
            <Text style={styles.typeBadgeText}>{label}</Text>
          </View>
        </View>

        {/* Provider name */}
        <Text style={styles.providerName} numberOfLines={1}>
          {account.provider}
        </Text>

        {/* Account name */}
        <Text style={styles.accountName} numberOfLines={1}>
          {account.name}
        </Text>

        {/* Balance */}
        <Text style={styles.balance}>{balanceStr}</Text>

        {/* Terms pill for credit cards */}
        {termsPill && onTermsClick && (
          <Pressable
            onPress={(e) => { e.stopPropagation?.(); onTermsClick(); }}
            style={styles.termsPillWrapper}
          >
            <View style={[styles.termsPill, termsPill.amber && styles.termsPillAmber]}>
              <Text style={[styles.termsPillText, termsPill.amber && styles.termsPillTextAmber]}>
                {termsPill.label}
              </Text>
            </View>
          </Pressable>
        )}
        {!termsPill && isCredit && onAddRates && (
          <Pressable
            onPress={(e) => { e.stopPropagation?.(); onAddRates(); }}
            style={styles.addRatesBtn}
          >
            <Text style={styles.addRatesText}>Add rates</Text>
          </Pressable>
        )}

        {/* Pin button */}
        {onTogglePin && !expired && (
          <Pressable
            onPress={(e) => { e.stopPropagation?.(); onTogglePin(); }}
            style={[styles.pinBtn, pinned && styles.pinBtnActive]}
          >
            <Pin size={12} color={pinned ? tw.color.indigo600 : "rgba(255,255,255,0.7)"} />
          </Pressable>
        )}

        {/* Decorative circle */}
        <View style={styles.decoCircle} pointerEvents="none" />

        {/* Expired overlay */}
        {expired && (
          <Pressable style={styles.expiredOverlay} onPress={onReconnect}>
            <View style={styles.expiredBadge}>
              <RefreshCw size={10} color={tw.color.amber500} />
              <Text style={styles.expiredText}>Reconnect</Text>
            </View>
          </Pressable>
        )}
      </LinearGradient>
    </Pressable>
  );
}

const CARD_MIN = 124;

const styles = StyleSheet.create({
  wrapper: {},
  card: {
    borderRadius: tw.radius["2xl"],
    padding: tw.space[4],
    minHeight: CARD_MIN,
    overflow: "hidden",
  },
  topRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: tw.space[3],
  },
  logoContainer: {
    width: 36,
    height: 36,
    borderRadius: tw.radius.xl,
    backgroundColor: "rgba(255,255,255,0.95)",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  logo: {
    width: 32,
    height: 32,
    borderRadius: 4,
  },
  logoFallback: {
    width: 36,
    height: 36,
    borderRadius: tw.radius.xl,
    backgroundColor: "rgba(255,255,255,0.25)",
    alignItems: "center",
    justifyContent: "center",
  },
  logoInitials: {
    color: tw.color.white,
    ...tw.text.xs,
    fontWeight: tw.weight.bold,
  },
  typeBadge: {
    backgroundColor: "rgba(255,255,255,0.2)",
    paddingHorizontal: tw.space[2],
    paddingVertical: tw.space[0.5],
    borderRadius: tw.radius.full,
  },
  typeBadgeText: {
    color: "rgba(255,255,255,0.9)",
    ...tw.text["10"],
    fontWeight: tw.weight.bold,
    textTransform: "uppercase",
    letterSpacing: tw.tracking(tw.trackingEm.wide, 10),
  },
  providerName: {
    color: "rgba(255,255,255,0.6)",
    ...tw.text["10"],
    fontWeight: tw.weight.semibold,
    textTransform: "uppercase",
    letterSpacing: tw.tracking(tw.trackingEm.widest, 10),
    marginBottom: tw.space[0.5],
  },
  accountName: {
    color: "rgba(255,255,255,0.75)",
    ...tw.text["11"],
    marginBottom: tw.space[2],
  },
  balance: {
    color: tw.color.white,
    fontSize: 20,
    lineHeight: 20,
    fontWeight: tw.weight.bold,
    letterSpacing: tw.tracking(tw.trackingEm.tight, 20),
  },
  termsPillWrapper: {
    marginTop: tw.space[1],
  },
  termsPill: {
    backgroundColor: "rgba(255,255,255,0.15)",
    borderRadius: tw.radius.full,
    paddingHorizontal: tw.space[2],
    paddingVertical: 2,
    alignSelf: "flex-start",
  },
  termsPillAmber: {
    backgroundColor: "rgba(245,158,11,0.25)",
  },
  termsPillText: {
    color: "rgba(255,255,255,0.85)",
    ...tw.text["10"],
    fontWeight: tw.weight.semibold,
  },
  termsPillTextAmber: {
    color: EXT.amber300,
  },
  addRatesBtn: {
    marginTop: tw.space[1],
    alignSelf: "flex-start",
  },
  addRatesText: {
    color: "rgba(255,255,255,0.7)",
    ...tw.text["10"],
    fontWeight: tw.weight.semibold,
    textDecorationLine: "underline",
  },
  pinBtn: {
    position: "absolute",
    bottom: tw.space[3],
    right: tw.space[3],
    width: 28,
    height: 28,
    borderRadius: tw.radius.lg,
    backgroundColor: "rgba(255,255,255,0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  pinBtnActive: {
    backgroundColor: tw.color.white,
  },
  decoCircle: {
    position: "absolute",
    bottom: -20,
    right: -20,
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: tw.color.white,
    opacity: 0.1,
  },
  expiredOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.5)",
    borderRadius: tw.radius["2xl"],
    alignItems: "center",
    justifyContent: "center",
  },
  expiredBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: tw.space[1],
    backgroundColor: "rgba(245,158,11,0.2)",
    borderRadius: tw.radius.full,
    paddingHorizontal: tw.space[3],
    paddingVertical: tw.space[1],
    borderWidth: 1,
    borderColor: tw.color.amber500,
  },
  expiredText: {
    color: tw.color.amber500,
    fontWeight: tw.weight.bold,
    ...tw.text.xs,
  },
});

export { BANK_META, FINEXER_ALIAS, LOGO_DOMAINS };
