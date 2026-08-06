import { useState } from "react";
import { View, Text, Image, StyleSheet } from "react-native";
import { Switch } from "react-native";
import { tw } from "@/lib/tw";
import type { Account } from "@/lib/api";

// ── Bank brand resolution (ported from frontend/components/AccountMiniCard.tsx) ──

const FINEXER_ALIAS: Record<string, string> = {
  natwest: "NATWEST", natwest_bankline: "NATWEST", natwest_clearspend: "NATWEST",
  rbs: "NATWEST", rbs_bankline: "NATWEST", rbs_clearspend: "NATWEST",
  chase_uk: "CHASE", amex: "AMEX", first_direct: "FIRST_DIRECT",
  barclays_personal: "BARCLAYS", barclays_business: "BARCLAYS",
  barclays_corporate: "BARCLAYS", barclays_wealth: "BARCLAYS",
  barclaycard_uk: "BARCLAYS", barclaycard_bcp: "BARCLAYS",
  hsbc_personal: "HSBC", hsbc_business: "HSBC", hsbc_kinetic: "HSBC",
  hsbc_net: "HSBC", hsbc_ms: "HSBC",
  lloyds_personal: "LLOYDS", lloyds_business: "LLOYDS", lloyds_commercial: "LLOYDS",
  halifax: "HALIFAX", santander: "SANTANDER", santander_business: "SANTANDER",
  santander_corporate: "SANTANDER", nationwide: "NATIONWIDE", tsb: "TSB",
  monzo: "MONZO", starling: "STARLING", revolut: "REVOLUT",
};

interface BankMeta {
  label: string;
  /** First hex colour from the gradient — used as the initials-badge solid bg */
  solidBg: string;
  initials: string;
}

const BANK_META: Record<string, BankMeta> = {
  BARCLAYS:     { label: "Barclays",     solidBg: "#00aeef", initials: "B"    },
  NATWEST:      { label: "NatWest",      solidBg: "#5a0069", initials: "NW"   },
  HSBC:         { label: "HSBC",         solidBg: "#db0011", initials: "HSBC" },
  MONZO:        { label: "Monzo",        solidBg: "#ff3464", initials: "M"    },
  STARLING:     { label: "Starling",     solidBg: "#6935d8", initials: "SB"   },
  LLOYDS:       { label: "Lloyds",       solidBg: "#024731", initials: "L"    },
  AMEX:         { label: "Amex",         solidBg: "#007bc1", initials: "AX"   },
  REVOLUT:      { label: "Revolut",      solidBg: "#191c1f", initials: "R"    },
  SANTANDER:    { label: "Santander",    solidBg: "#ec0000", initials: "S"    },
  HALIFAX:      { label: "Halifax",      solidBg: "#1c5aa0", initials: "HFX"  },
  NATIONWIDE:   { label: "Nationwide",   solidBg: "#1a2e6b", initials: "NBS"  },
  CHASE:        { label: "Chase",        solidBg: "#117aca", initials: "Ch"   },
  FIRST_DIRECT: { label: "first direct", solidBg: "#111111", initials: "fd"   },
  TSB:          { label: "TSB",          solidBg: "#006ab0", initials: "TSB"  },
  MONO:         { label: "Mono",         solidBg: "#1a1a2e", initials: "M"    },
  MPESA:        { label: "M-Pesa",       solidBg: "#4caf50", initials: "MP"   },
  EQUITY:       { label: "Equity Bank",  solidBg: "#e60000", initials: "EQ"   },
  KCB:          { label: "KCB",          solidBg: "#006400", initials: "KCB"  },
  NCBA:         { label: "NCBA",         solidBg: "#00205b", initials: "NCBA" },
  STANBIC:      { label: "Stanbic",      solidBg: "#003087", initials: "SB"   },
  ABSA:         { label: "Absa",         solidBg: "#dc143c", initials: "ABS"  },
  COOP:         { label: "Co-op Bank",   solidBg: "#003087", initials: "CO"   },
  DTB:          { label: "DTB",          solidBg: "#1a237e", initials: "DTB"  },
  STANCHART:    { label: "Std Chartered",solidBg: "#00a0e3", initials: "SC"   },
  FAMILY:       { label: "Family Bank",  solidBg: "#ff6600", initials: "FB"   },
  IMBANK:       { label: "I&M Bank",     solidBg: "#b22222", initials: "I&M"  },
};

function bankKey(account: { provider?: string; provider_id?: string }): string {
  const pid = (account.provider_id ?? "").toLowerCase();
  if (pid && FINEXER_ALIAS[pid]) return FINEXER_ALIAS[pid];
  const n = (account.provider ?? "").toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "");
  if (!n) return "";
  if (BANK_META[n]) return n;
  const stripped = n.replace(/_(UK|PERSONAL|BUSINESS|CORPORATE|COMMERCIAL|WEALTH|CURRENT|SAVINGS|ONLINE|365)$/, "");
  if (stripped !== n && BANK_META[stripped]) return stripped;
  return n;
}

/**
 * Resolve logo URI for an account.
 * On React Native we can't use Google favicon service reliably in all network
 * conditions, so we fall back to the initials badge more readily.
 * local logoFile assets are not bundled here; only remote logo_url is used.
 */
function resolveLogoUri(account: Account): string | null {
  // Finexer dynamic logo_url (when available)
  if (account.logo_url) return account.logo_url;
  return null;
}

// ── BankBadge ────────────────────────────────────────────────────────────────

function BankBadge({ account }: { account: Account }) {
  const [imgFailed, setImgFailed] = useState(false);
  const key = bankKey(account);
  const meta = BANK_META[key];
  const logoUri = resolveLogoUri(account);

  if (logoUri && !imgFailed) {
    return (
      <Image
        source={{ uri: logoUri }}
        style={styles.badge}
        onError={() => setImgFailed(true)}
        resizeMode="contain"
        accessibilityLabel={meta?.label ?? account.provider ?? "Bank"}
      />
    );
  }

  // Initials fallback
  const initials = meta?.initials ?? (account.provider ?? "?").slice(0, 2).toUpperCase();
  const solidBg = meta?.solidBg ?? (account.bg_colors?.[0] ?? "#2563eb");
  const initialsSize = initials.length >= 4 ? 8 : initials.length === 3 ? 10 : 13;

  return (
    <View style={[styles.badge, { backgroundColor: solidBg }]}>
      <Text style={[styles.badgeText, { fontSize: initialsSize }]}>{initials}</Text>
    </View>
  );
}

// ── AccountMiniCard ──────────────────────────────────────────────────────────

interface AccountMiniCardProps {
  account: Account;
  allowed: boolean;
  onToggle: () => void;
  dark: boolean;
  withTopBorder?: boolean;
}

/**
 * Single row in the "Where Money Can Come From" section.
 *
 * Spec: flex row, items-center, gap-3, px-4 py-3, min-h-44px.
 * Left: 36×36 BankBadge. Middle: name + provider subtext (conditional).
 * Right: Toggle switch.
 */
export function AccountMiniCard({ account, allowed, onToggle, dark, withTopBorder = false }: AccountMiniCardProps) {
  const key = bankKey(account);
  const meta = BANK_META[key];
  const providerLabel = meta?.label ?? account.provider ?? null;

  // Spec: subtext renders only when acc.manual || acc.provider
  const showSubtext = !!(account.manual || account.provider);
  const subtextLabel = account.manual ? "Offline account" : providerLabel ?? "";

  return (
    <View
      style={[
        styles.row,
        withTopBorder && {
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: dark ? tw.color.slate700 : tw.color.slate100,
        },
      ]}
    >
      <BankBadge account={account} />

      <View style={styles.middle}>
        <Text
          style={[styles.accountName, { color: dark ? tw.color.slate100 : tw.color.slate900 }]}
          numberOfLines={1}
        >
          {account.name}
        </Text>
        {showSubtext ? (
          <Text
            style={[styles.provider, { color: dark ? tw.color.slate500 : tw.color.slate400 }]}
            numberOfLines={1}
          >
            {subtextLabel}
          </Text>
        ) : null}
      </View>

      <Switch
        value={allowed}
        onValueChange={onToggle}
        trackColor={{ false: dark ? tw.color.slate700 : tw.color.slate200, true: tw.color.indigo500 }}
        thumbColor={tw.color.white}
        accessibilityLabel={`Allow transfers from ${account.name}`}
        accessibilityRole="switch"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    width: 36,
    height: 36,
    borderRadius: tw.radius.xl,
    backgroundColor: tw.color.slate200,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  badgeText: {
    color: tw.color.white,
    fontWeight: tw.weight.bold,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: tw.space[3],
    paddingHorizontal: tw.space[4],
    paddingVertical: tw.space[3],
    minHeight: 44,
  },
  middle: {
    flex: 1,
  },
  accountName: {
    fontSize: tw.text.sm.fontSize,
    lineHeight: tw.text.sm.lineHeight,
    fontWeight: tw.weight.medium,
  },
  provider: {
    fontSize: tw.text.xs.fontSize,
    lineHeight: tw.text.xs.lineHeight,
    fontWeight: "400",
  },
});
