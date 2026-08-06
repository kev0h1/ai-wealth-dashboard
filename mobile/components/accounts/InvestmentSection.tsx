/**
 * InvestmentSection — Investments tab content for the Accounts screen.
 * Manages list of investment accounts, expansion state, holdings/notes fetch,
 * cold-start contract note flow, and statement upload triggering.
 */

import React, { useState, useCallback } from "react";
import {
  View, Text, Pressable, StyleSheet, ActivityIndicator,
  TextInput,
} from "react-native";
import { TrendingUp, Upload, Eye, EyeOff, CheckCircle } from "lucide-react-native";
import { tw, HAIRLINE } from "@/lib/tw";

// Tokens present in the shared tw.ts but not yet in this worktree's copy
const EXT = {
  amber300: "#fcd34d",
} as const;
import { accountsApi } from "@/lib/api/accounts";
import type { InvestmentHolding } from "@/lib/shared";
import type { InvestmentAccountFull, InvestmentNote, RNFile } from "@/lib/api/accounts";
import { InvestmentMiniCard } from "./InvestmentMiniCard";

interface InvestmentSectionProps {
  dark: boolean;
  hidden: boolean;
  onUploadStatement: () => void;
  /** Called after any mutation that should reload the investment list */
  onReload: () => void;
}

export function InvestmentSection({
  dark,
  hidden,
  onUploadStatement,
  onReload,
}: InvestmentSectionProps) {
  const cardBg = dark ? tw.color.cardDark : tw.color.cardLight;
  const borderColor = dark ? tw.color.cardBorderDark : tw.color.cardBorderLight;
  const ink = dark ? tw.color.slate100 : tw.color.slate900;
  const muted = tw.color.slate400;

  const [accounts, setAccounts] = useState<InvestmentAccountFull[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Per-account expansion, holdings, notes, refreshing
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [holdings, setHoldings] = useState<Record<string, InvestmentHolding[]>>({});
  const [holdingsLoading, setHoldingsLoading] = useState<Record<string, boolean>>({});
  const [notes, setNotes] = useState<Record<string, InvestmentNote[]>>({});
  const [notesLoading, setNotesLoading] = useState<Record<string, boolean>>({});
  const [refreshing, setRefreshing] = useState<Record<string, boolean>>({});

  // Cold-start form state
  const [showColdStart, setShowColdStart] = useState(false);
  const [coldPassword, setColdPassword] = useState("");
  const [showColdPassword, setShowColdPassword] = useState(false);
  const [coldFile, setColdFile] = useState<RNFile | null>(null);
  const [coldUploading, setColdUploading] = useState(false);
  const [coldError, setColdError] = useState<string | null>(null);
  const [coldSuccess, setColdSuccess] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await accountsApi.getInvestmentAccountsFull();
      setAccounts(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { load(); }, [load]);

  const toggleExpand = useCallback(async (id: string) => {
    const nowExpanded = !expanded[id];
    setExpanded(prev => ({ ...prev, [id]: nowExpanded }));

    if (nowExpanded) {
      // Fetch holdings + notes on expand
      setHoldingsLoading(prev => ({ ...prev, [id]: true }));
      setNotesLoading(prev => ({ ...prev, [id]: true }));
      try {
        const [h, n] = await Promise.all([
          accountsApi.getInvestmentHoldings(id),
          accountsApi.investmentNotes(id),
        ]);
        setHoldings(prev => ({ ...prev, [id]: h }));
        setNotes(prev => ({ ...prev, [id]: n }));
      } catch {
        // non-fatal — show empty
      } finally {
        setHoldingsLoading(prev => ({ ...prev, [id]: false }));
        setNotesLoading(prev => ({ ...prev, [id]: false }));
      }
    }
  }, [expanded]);

  const handleRefreshPrices = useCallback(async (id: string) => {
    setRefreshing(prev => ({ ...prev, [id]: true }));
    try {
      await accountsApi.refreshInvestmentPrices(id);
      // Reload account list + holdings
      const [data, h] = await Promise.all([
        accountsApi.getInvestmentAccountsFull(),
        accountsApi.getInvestmentHoldings(id),
      ]);
      setAccounts(data);
      setHoldings(prev => ({ ...prev, [id]: h }));
    } catch {
      // non-fatal
    } finally {
      setRefreshing(prev => ({ ...prev, [id]: false }));
    }
  }, []);

  const handleDelete = useCallback(async (id: string) => {
    try {
      await accountsApi.deleteInvestmentAccount(id);
      setAccounts(prev => prev.filter(a => a.id !== id));
      onReload();
    } catch {
      // non-fatal
    }
  }, [onReload]);

  const handleUploadNote = useCallback(async (accountId: string, file: RNFile, password?: string) => {
    const result = await accountsApi.uploadInvestmentNote(accountId, file, password);
    // Refresh notes for this account
    const n = await accountsApi.investmentNotes(accountId);
    setNotes(prev => ({ ...prev, [accountId]: n }));
    // Update account totals
    const data = await accountsApi.getInvestmentAccountsFull();
    setAccounts(data);
    onReload();
    return result;
  }, [onReload]);

  const handleDeleteNote = useCallback(async (accountId: string, noteId: string) => {
    try {
      await accountsApi.deleteInvestmentNote(noteId);
      const n = await accountsApi.investmentNotes(accountId);
      setNotes(prev => ({ ...prev, [accountId]: n }));
      const data = await accountsApi.getInvestmentAccountsFull();
      setAccounts(data);
      onReload();
    } catch {
      // non-fatal
    }
  }, [onReload]);

  async function pickColdFile() {
    try {
      const { getDocumentAsync } = await import("expo-document-picker");
      const result = await getDocumentAsync({ type: "application/pdf", copyToCacheDirectory: true });
      if (!result.canceled && result.assets?.[0]) {
        const asset = result.assets[0];
        setColdFile({ uri: asset.uri, name: asset.name, mimeType: asset.mimeType ?? "application/pdf" });
        setColdError(null);
      }
    } catch {
      setColdError("Could not open file picker");
    }
  }

  async function handleColdStart() {
    if (!coldFile || coldUploading) return;
    setColdUploading(true);
    setColdError(null);
    try {
      await accountsApi.uploadInvestmentNoteColdStart(coldFile, coldPassword || undefined);
      setColdSuccess(true);
      setColdFile(null);
      setColdPassword("");
      setShowColdStart(false);
      await load();
      onReload();
      setTimeout(() => setColdSuccess(false), 2000);
    } catch (e) {
      setColdError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setColdUploading(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.centeredLoad}>
        <ActivityIndicator color={tw.color.indigo500} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centeredLoad}>
        <Text style={[styles.errorText, { color: muted }]}>{error}</Text>
        <Pressable onPress={load} style={styles.retryBtn}>
          <Text style={styles.retryText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  if (accounts.length === 0) {
    return (
      <View style={[styles.emptyCard, { backgroundColor: cardBg, borderColor }]}>
        <View style={[styles.emptyIconBox, { backgroundColor: dark ? tw.color.slate700 : tw.color.indigo50 }]}>
          <TrendingUp size={28} color={tw.color.indigo600} />
        </View>
        <Text style={[styles.emptyHeading, { color: ink }]}>No investment accounts</Text>
        <Text style={[styles.emptyBody, { color: muted }]}>
          Upload a quarterly statement from Vanguard, Wealthify, HL, Fidelity, AJ Bell.
        </Text>
        <Pressable
          onPress={onUploadStatement}
          style={({ pressed }) => [styles.primaryBtn, { opacity: pressed ? 0.8 : 1 }]}
        >
          <Upload size={16} color={tw.color.white} />
          <Text style={styles.primaryBtnText}>Upload Statement</Text>
        </Pressable>

        {/* Cold-start: add contract note without a statement */}
        <Pressable
          onPress={() => setShowColdStart(v => !v)}
          style={({ pressed }) => [styles.secondaryBtn, { opacity: pressed ? 0.7 : 1 }]}
        >
          <Text style={[styles.secondaryBtnText, { color: tw.color.indigo600 }]}>Add contract note</Text>
        </Pressable>

        {showColdStart && (
          <View style={[styles.coldStartForm, { borderColor }]}>
            <Text style={[styles.coldStartTitle, { color: ink }]}>Cold-start: contract note</Text>
            <Text style={[styles.coldStartBody, { color: muted }]}>
              Creates a provisional investment account from a single contract note PDF.
              Upload a statement later to set the real base value.
            </Text>

            {/* Password */}
            <View style={styles.passwordRow}>
              <TextInput
                style={[styles.passwordInput, {
                  backgroundColor: dark ? tw.color.slate700 : tw.color.white,
                  borderColor: dark ? tw.color.slate500 : tw.color.slate200,
                  color: ink,
                }]}
                placeholder="Password (if protected)"
                placeholderTextColor={muted}
                secureTextEntry={!showColdPassword}
                value={coldPassword}
                onChangeText={setColdPassword}
                autoCapitalize="none"
              />
              <Pressable onPress={() => setShowColdPassword(v => !v)} style={styles.eyeBtn}>
                {showColdPassword ? <EyeOff size={15} color={muted} /> : <Eye size={15} color={muted} />}
              </Pressable>
            </View>

            {/* File picker */}
            <Pressable
              onPress={pickColdFile}
              style={[styles.filePicker, { borderColor: dark ? tw.color.slate500 : tw.color.slate200 }]}
            >
              <Upload size={16} color={tw.color.indigo500} />
              <Text style={[styles.filePickerText, { color: coldFile ? ink : muted }]}>
                {coldFile ? coldFile.name : "Choose PDF contract note"}
              </Text>
            </Pressable>

            {coldError && (
              <View style={[styles.errorBox, { backgroundColor: dark ? tw.color.amber900 : tw.color.amber50 }]}>
                <Text style={[styles.errorBoxText, { color: dark ? EXT.amber300 : tw.color.amber700 }]}>
                  {coldError}
                </Text>
              </View>
            )}

            {coldSuccess && (
              <View style={styles.successRow}>
                <CheckCircle size={16} color={tw.color.emerald500} />
                <Text style={[styles.successText, { color: tw.color.emerald500 }]}>Account created!</Text>
              </View>
            )}

            <Pressable
              onPress={handleColdStart}
              disabled={!coldFile || coldUploading}
              style={({ pressed }) => [
                styles.primaryBtn,
                { opacity: (!coldFile || coldUploading || pressed) ? 0.5 : 1 },
              ]}
            >
              {coldUploading
                ? <ActivityIndicator size="small" color={tw.color.white} />
                : (
                  <>
                    <Upload size={16} color={tw.color.white} />
                    <Text style={styles.primaryBtnText}>Upload note</Text>
                  </>
                )}
            </Pressable>
          </View>
        )}
      </View>
    );
  }

  return (
    <View style={styles.list}>
      {accounts.map(account => (
        <InvestmentMiniCard
          key={account.id}
          account={account}
          dark={dark}
          hidden={hidden}
          expanded={!!expanded[account.id]}
          onToggleExpand={() => toggleExpand(account.id)}
          holdings={holdings[account.id] ?? null}
          holdingsLoading={!!holdingsLoading[account.id]}
          notes={notes[account.id] ?? null}
          notesLoading={!!notesLoading[account.id]}
          refreshing={!!refreshing[account.id]}
          onRefreshPrices={() => handleRefreshPrices(account.id)}
          onDelete={() => handleDelete(account.id)}
          onUploadStatement={onUploadStatement}
          onUploadNote={async (file, password) => { await handleUploadNote(account.id, file, password); }}
          onDeleteNote={(noteId) => handleDeleteNote(account.id, noteId)}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  centeredLoad: {
    padding: tw.space[8],
    alignItems: "center",
    gap: tw.space[3],
  },
  errorText: {
    ...tw.text.sm,
    textAlign: "center",
  },
  retryBtn: {
    paddingHorizontal: tw.space[4],
    paddingVertical: tw.space[2],
    borderRadius: tw.radius.xl,
    backgroundColor: tw.color.indigo600,
  },
  retryText: {
    color: tw.color.white,
    ...tw.text.sm,
    fontWeight: tw.weight.semibold,
  },
  emptyCard: {
    borderRadius: tw.radius["2xl"],
    borderWidth: HAIRLINE,
    padding: tw.space[6],
    alignItems: "center",
    gap: tw.space[3],
    marginHorizontal: tw.space[4],
  },
  emptyIconBox: {
    width: 56,
    height: 56,
    borderRadius: tw.radius["2xl"],
    alignItems: "center",
    justifyContent: "center",
  },
  emptyHeading: {
    ...tw.text.base,
    fontWeight: tw.weight.bold,
    textAlign: "center",
  },
  emptyBody: {
    ...tw.text.sm,
    textAlign: "center",
    lineHeight: 20,
  },
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: tw.space[2],
    backgroundColor: tw.color.indigo600,
    paddingHorizontal: tw.space[5],
    paddingVertical: tw.space[2.5],
    borderRadius: tw.radius["2xl"],
  },
  primaryBtnText: {
    color: tw.color.white,
    ...tw.text.sm,
    fontWeight: tw.weight.semibold,
  },
  secondaryBtn: {
    paddingHorizontal: tw.space[4],
    paddingVertical: tw.space[2],
  },
  secondaryBtnText: {
    ...tw.text.sm,
    fontWeight: tw.weight.semibold,
  },
  coldStartForm: {
    width: "100%",
    borderTopWidth: HAIRLINE,
    paddingTop: tw.space[4],
    gap: tw.space[3],
  },
  coldStartTitle: {
    ...tw.text.sm,
    fontWeight: tw.weight.bold,
  },
  coldStartBody: {
    ...tw.text.xs,
    lineHeight: 18,
  },
  passwordRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  passwordInput: {
    flex: 1,
    ...tw.text.xs,
    borderWidth: 1,
    borderRadius: tw.radius.xl,
    paddingHorizontal: tw.space[3],
    paddingVertical: tw.space[2],
    paddingRight: tw.space[9],
  },
  eyeBtn: {
    position: "absolute",
    right: tw.space[3],
    padding: tw.space[1],
  },
  filePicker: {
    flexDirection: "row",
    alignItems: "center",
    gap: tw.space[2],
    borderWidth: 2,
    borderStyle: "dashed",
    borderRadius: tw.radius["2xl"],
    padding: tw.space[3],
  },
  filePickerText: {
    ...tw.text.xs,
    fontWeight: tw.weight.medium,
    flex: 1,
  },
  errorBox: {
    borderRadius: tw.radius.xl,
    padding: tw.space[3],
  },
  errorBoxText: {
    ...tw.text.xs,
  },
  successRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: tw.space[2],
  },
  successText: {
    ...tw.text.xs,
    fontWeight: tw.weight.semibold,
  },
  list: {
    paddingHorizontal: tw.space[4],
  },
});
