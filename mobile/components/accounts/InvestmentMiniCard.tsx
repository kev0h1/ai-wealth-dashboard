/**
 * InvestmentMiniCard — collapsible card for a single investment account.
 * Replicates the web AccountsPage investment account section 1:1.
 */

import {
  View, Text, Pressable, StyleSheet, ActivityIndicator,
  TextInput, Switch,
} from "react-native";
import {
  TrendingUp, ChevronDown, ChevronUp, RefreshCw, Trash2,
  Upload, FileText, Eye, EyeOff, CheckCircle,
} from "lucide-react-native";
import { tw, HAIRLINE } from "@/lib/tw";

// Tokens present in the shared tw.ts but not yet in this worktree's copy
const EXT = {
  amber300: "#fcd34d",
  amber800: "#92400e",
  rose500:  "#f43f5e",
} as const;
import type { InvestmentHolding } from "@/lib/shared";
import type { InvestmentAccountFull, InvestmentNote, RNFile } from "@/lib/api/accounts";

interface InvestmentMiniCardProps {
  account: InvestmentAccountFull;
  dark: boolean;
  hidden: boolean;
  expanded: boolean;
  onToggleExpand: () => void;
  holdings: InvestmentHolding[] | null;
  holdingsLoading: boolean;
  notes: InvestmentNote[] | null;
  notesLoading: boolean;
  refreshing: boolean;
  onRefreshPrices: () => void;
  onDelete: () => void;
  onUploadStatement: () => void;
  /** Upload a new contract note to an existing account */
  onUploadNote: (file: RNFile, password?: string) => Promise<void>;
  onDeleteNote: (noteId: string) => void;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return iso;
  }
}

function fmtGBP(n: number): string {
  return `£${Math.abs(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Investment provider gradient colours [from, to] */
const INV_META: Record<string, [string, string]> = {
  VANGUARD:              ["#8b0000", "#c0392b"],
  WEALTHIFY:             ["#006d6d", "#00a896"],
  "HARGREAVES LANSDOWN": ["#002d72", "#0057c2"],
  HL:                    ["#002d72", "#0057c2"],
  FIDELITY:              ["#7b3f00", "#c0602a"],
  "AJ BELL":             ["#003087", "#c0932a"],
  NUTMEG:                ["#1a1a2e", "#e94560"],
  MONEYBOX:              ["#1b4f72", "#2e86c1"],
  TRADING212:            ["#006400", "#228b22"],
  FREETRADE:             ["#1a0a4a", "#5e35b1"],
};

function investmentGradient(provider: string): [string, string] {
  const key = provider.toUpperCase().replace(/[\s-]+/g, " ").trim();
  return INV_META[key] ?? ["#3730a3", "#4f46e5"];
}

export function InvestmentMiniCard({
  account,
  dark,
  hidden,
  expanded,
  onToggleExpand,
  holdings,
  holdingsLoading,
  notes,
  notesLoading,
  refreshing,
  onRefreshPrices,
  onDelete,
  onUploadStatement,
  onUploadNote,
  onDeleteNote,
}: InvestmentMiniCardProps) {
  const cardBg = dark ? tw.color.cardDark : tw.color.cardLight;
  const borderColor = dark ? tw.color.cardBorderDark : tw.color.cardBorderLight;
  const ink = dark ? tw.color.slate100 : tw.color.slate900;
  const muted = tw.color.slate400;
  const subMuted = dark ? tw.color.slate500 : tw.color.slate500;

  const displayValue = account.display_value ?? account.total_value;
  const [grad0, grad1] = investmentGradient(account.provider);

  // Notes display: last 6, show all toggle
  const [showAllNotes, setShowAllNotes] = React.useState(false);
  const [showNoteForm, setShowNoteForm] = React.useState(false);
  const [notePassword, setNotePassword] = React.useState("");
  const [showNotePassword, setShowNotePassword] = React.useState(false);
  const [noteFile, setNoteFile] = React.useState<RNFile | null>(null);
  const [noteUploading, setNoteUploading] = React.useState(false);
  const [noteError, setNoteError] = React.useState<string | null>(null);
  const [noteSuccess, setNoteSuccess] = React.useState(false);

  const activeNotes = (notes ?? []).filter(n => !n.superseded);
  const supersededCount = (notes ?? []).filter(n => n.superseded).length;
  const visibleNotes = showAllNotes ? activeNotes : activeNotes.slice(-6);

  async function handleNoteUpload() {
    if (!noteFile || noteUploading) return;
    setNoteUploading(true);
    setNoteError(null);
    try {
      await onUploadNote(noteFile, notePassword || undefined);
      setNoteSuccess(true);
      setNoteFile(null);
      setNotePassword("");
      setShowNoteForm(false);
      setTimeout(() => setNoteSuccess(false), 2000);
    } catch (err) {
      setNoteError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setNoteUploading(false);
    }
  }

  async function pickNoteFile() {
    try {
      const { getDocumentAsync } = await import("expo-document-picker");
      const result = await getDocumentAsync({ type: "application/pdf", copyToCacheDirectory: true });
      if (!result.canceled && result.assets?.[0]) {
        const asset = result.assets[0];
        setNoteFile({ uri: asset.uri, name: asset.name, mimeType: asset.mimeType ?? "application/pdf" });
        setNoteError(null);
      }
    } catch {
      setNoteError("Could not open file picker");
    }
  }

  // Decomposed value line
  let decomposedLine = "";
  if (account.provisional) {
    decomposedLine = `No statement yet — running total from £0`;
    if (account.added_since && account.notes_since > 0) {
      const sign = account.added_since >= 0 ? "+" : "−";
      decomposedLine += ` · ${sign}${fmtGBP(account.added_since)} added (${account.notes_since} note${account.notes_since !== 1 ? "s" : ""})`;
    }
  } else if (account.last_refreshed && account.display_value != null) {
    decomposedLine = `${fmtGBP(account.total_value)} · prices refreshed ${fmtDate(account.last_refreshed)}`;
    if (account.added_since !== 0) {
      const sign = account.added_since >= 0 ? "+" : "−";
      decomposedLine += ` · ${sign}${fmtGBP(account.added_since)} added (${account.notes_since} note${account.notes_since !== 1 ? "s" : ""})`;
    }
  } else if (account.statement_date) {
    decomposedLine = `Valued ${fmtGBP(account.total_value)} on ${fmtDate(account.statement_date)}`;
    if (account.added_since !== 0) {
      const sign = account.added_since >= 0 ? "+" : "−";
      decomposedLine += ` · ${sign}${fmtGBP(account.added_since)} added (${account.notes_since} note${account.notes_since !== 1 ? "s" : ""})`;
    }
  }

  return (
    <View style={[styles.card, { backgroundColor: cardBg, borderColor }]}>
      {/* Header row — always visible */}
      <Pressable onPress={onToggleExpand} style={styles.headerRow}>
        <View style={styles.headerLeft}>
          <View style={[styles.invIconBox, { backgroundColor: `${grad0}22` }]}>
            <TrendingUp size={16} color={grad0} />
          </View>
          <View style={styles.headerMeta}>
            <View style={styles.headerNameRow}>
              <Text style={[styles.accountName, { color: ink }]} numberOfLines={1}>
                {account.provider}
              </Text>
              {account.provisional && (
                <View style={styles.provBadge}>
                  <Text style={styles.provBadgeText}>NO STATEMENT YET</Text>
                </View>
              )}
            </View>
            <Text style={[styles.accountType, { color: subMuted }]} numberOfLines={1}>
              {account.account_type}
              {account.account_reference ? ` · ${account.account_reference}` : ""}
            </Text>
          </View>
        </View>
        <View style={styles.headerRight}>
          <Text style={[styles.totalValue, { color: ink }]}>
            {hidden ? "••••" : fmtGBP(displayValue)}
          </Text>
          {expanded
            ? <ChevronUp size={14} color={muted} />
            : <ChevronDown size={14} color={muted} />}
        </View>
      </Pressable>

      {/* Expanded content */}
      {expanded && (
        <View style={[styles.expandedContent, { borderTopColor: borderColor }]}>
          {/* Action bar */}
          <View style={styles.actionBar}>
            <Pressable
              onPress={onRefreshPrices}
              disabled={refreshing}
              style={({ pressed }) => [styles.actionBtnRefresh, { opacity: pressed || refreshing ? 0.6 : 1 }]}
            >
              <RefreshCw size={14} color={tw.color.indigo600} style={refreshing ? undefined : undefined} />
              <Text style={styles.actionBtnRefreshText}>
                {refreshing ? "Refreshing…" : "Refresh prices"}
              </Text>
            </Pressable>
            <Pressable
              onPress={onDelete}
              style={({ pressed }) => [styles.actionBtnDelete, { opacity: pressed ? 0.6 : 1 }]}
            >
              <Trash2 size={14} color={EXT.rose500} />
            </Pressable>
          </View>

          {/* Decomposed value line */}
          {decomposedLine ? (
            <Text style={[styles.decomposedLine, { color: subMuted }]}>{decomposedLine}</Text>
          ) : null}

          {/* Info box */}
          <View style={[styles.infoBox, { backgroundColor: dark ? tw.color.slate800 : tw.color.slate50 }]}>
            <Text style={[styles.infoBoxLabel, { color: muted }]}>HOW THIS ACCOUNT STAYS CURRENT</Text>
            <Text style={[styles.infoBoxBody, { color: dark ? tw.color.slate400 : tw.color.slate600 }]}>
              Upload a quarterly statement to set the base value, then add contract notes for any buys or sales since.
              Prices refresh automatically each day for known funds.
            </Text>

            <View style={styles.uploadBtnRow}>
              <Pressable
                onPress={onUploadStatement}
                style={({ pressed }) => [styles.uploadBtn, { opacity: pressed ? 0.7 : 1, borderColor: dark ? tw.color.slate500 : tw.color.slate200 }]}
              >
                <Upload size={14} color={dark ? tw.color.slate300 : tw.color.slate600} />
                <Text style={[styles.uploadBtnText, { color: dark ? tw.color.slate300 : tw.color.slate600 }]}>
                  Upload statement
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setShowNoteForm(v => !v)}
                style={({ pressed }) => [styles.noteBtn, { opacity: pressed ? 0.7 : 1 }]}
              >
                <FileText size={14} color={tw.color.white} />
                <Text style={styles.noteBtnText}>Add contract note</Text>
              </Pressable>
            </View>

            {/* Inline contract note form */}
            {showNoteForm && (
              <View style={styles.noteForm}>
                {/* Password */}
                <View style={styles.notePasswordRow}>
                  <TextInput
                    style={[styles.notePasswordInput, {
                      backgroundColor: dark ? tw.color.slate700 : tw.color.white,
                      borderColor: dark ? tw.color.slate500 : tw.color.slate200,
                      color: ink,
                    }]}
                    placeholder="Password (if PDF is protected)"
                    placeholderTextColor={muted}
                    secureTextEntry={!showNotePassword}
                    value={notePassword}
                    onChangeText={setNotePassword}
                    autoCapitalize="none"
                  />
                  <Pressable onPress={() => setShowNotePassword(v => !v)} style={styles.eyeBtn}>
                    {showNotePassword
                      ? <EyeOff size={15} color={muted} />
                      : <Eye size={15} color={muted} />}
                  </Pressable>
                </View>

                {/* File picker */}
                <Pressable
                  onPress={pickNoteFile}
                  style={[styles.filePicker, { borderColor: dark ? tw.color.slate500 : tw.color.slate200 }]}
                >
                  <Upload size={16} color={tw.color.indigo500} />
                  <Text style={[styles.filePickerText, { color: noteFile ? ink : muted }]}>
                    {noteFile ? noteFile.name : "Choose PDF contract note"}
                  </Text>
                </Pressable>

                {noteError && (
                  <View style={[styles.errorBox, { backgroundColor: dark ? EXT.amber800 : tw.color.amber50 }]}>
                    <Text style={[styles.errorText, { color: dark ? EXT.amber300 : tw.color.amber700 }]}>
                      {noteError}
                    </Text>
                  </View>
                )}

                {noteSuccess && (
                  <View style={styles.successRow}>
                    <CheckCircle size={16} color={tw.color.emerald500} />
                    <Text style={[styles.successText, { color: tw.color.emerald500 }]}>Note uploaded</Text>
                  </View>
                )}

                <Pressable
                  onPress={handleNoteUpload}
                  disabled={!noteFile || noteUploading}
                  style={({ pressed }) => [
                    styles.submitBtn,
                    { opacity: (!noteFile || noteUploading || pressed) ? 0.5 : 1 },
                  ]}
                >
                  {noteUploading
                    ? <ActivityIndicator size="small" color={tw.color.white} />
                    : <Text style={styles.submitBtnText}>Upload note</Text>}
                </Pressable>
              </View>
            )}
          </View>

          {/* Contract notes list */}
          {notesLoading ? (
            <ActivityIndicator size="small" color={tw.color.indigo500} style={styles.notesLoader} />
          ) : activeNotes.length > 0 ? (
            <View style={styles.notesSection}>
              <Text style={[styles.notesSectionLabel, { color: muted }]}>CONTRACT NOTES</Text>
              <View style={[styles.notesCard, { backgroundColor: cardBg, borderColor }]}>
                {visibleNotes.map((note, idx) => (
                  <View
                    key={note.id}
                    style={[
                      styles.noteRow,
                      idx < visibleNotes.length - 1 && { borderBottomWidth: HAIRLINE, borderBottomColor: borderColor },
                    ]}
                  >
                    <View style={styles.noteRowLeft}>
                      <Text style={[styles.noteDate, { color: subMuted }]}>{fmtDate(note.trade_date)}</Text>
                      <Text style={[styles.noteFund, { color: dark ? tw.color.slate300 : tw.color.slate700 }]} numberOfLines={1}>
                        {note.fund_name}
                      </Text>
                      {note.kind === "sale" && (
                        <Text style={[styles.noteSoldBadge, { color: muted }]}>SOLD</Text>
                      )}
                      <Text style={[
                        styles.noteAmount,
                        { color: note.kind === "buy" ? tw.color.emerald500 : EXT.rose500 },
                      ]}>
                        {note.kind === "buy" ? "+" : "−"}{fmtGBP(Math.abs(note.amount))}
                      </Text>
                    </View>
                    <Pressable
                      onPress={() => onDeleteNote(note.id)}
                      style={({ pressed }) => [styles.noteDeleteBtn, { opacity: pressed ? 0.5 : 1 }]}
                    >
                      <Trash2 size={14} color={muted} />
                    </Pressable>
                  </View>
                ))}
              </View>

              {activeNotes.length > 6 && (
                <Pressable onPress={() => setShowAllNotes(v => !v)} style={styles.showMoreBtn}>
                  <Text style={styles.showMoreText}>
                    {showAllNotes ? "Show fewer" : `Show all ${activeNotes.length}`}
                  </Text>
                </Pressable>
              )}

              {supersededCount > 0 && (
                <Text style={[styles.supersededText, { color: muted }]}>
                  ({supersededCount} note{supersededCount !== 1 ? "s" : ""} folded into statement)
                </Text>
              )}
            </View>
          ) : null}

          {/* Holdings list */}
          {!account.provisional && (
            holdingsLoading ? (
              <ActivityIndicator size="small" color={tw.color.indigo500} style={styles.holdingsLoader} />
            ) : holdings && holdings.length > 0 ? (
              <View style={styles.holdingsSection}>
                {holdings.map((h, idx) => (
                  <View
                    key={h.id}
                    style={[
                      styles.holdingRow,
                      idx < holdings.length - 1 && { borderBottomWidth: HAIRLINE, borderBottomColor: borderColor },
                    ]}
                  >
                    <View style={styles.holdingLeft}>
                      <Text style={[styles.holdingName, { color: dark ? tw.color.slate300 : tw.color.slate700 }]} numberOfLines={1}>
                        {h.name}
                      </Text>
                      <Text style={[styles.holdingMeta, { color: subMuted }]}>
                        {[h.isin, h.type, h.units != null ? `${h.units} units` : null]
                          .filter(Boolean)
                          .join(" · ")}
                      </Text>
                      {h.current_price != null ? (
                        <Text style={[styles.holdingPrice, { color: tw.color.emerald600 }]}>
                          {`£${h.current_price.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 4 })} / unit`}
                        </Text>
                      ) : h.price_per_unit != null ? (
                        <Text style={[styles.holdingPrice, { color: subMuted }]}>
                          {`£${h.price_per_unit.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 4 })} / unit`}
                        </Text>
                      ) : null}
                    </View>
                    <Text style={[styles.holdingValue, { color: ink }]}>
                      {hidden ? "••••" : fmtGBP(h.current_value ?? h.statement_value)}
                    </Text>
                  </View>
                ))}
              </View>
            ) : (
              <Text style={[styles.noHoldings, { color: muted }]}>No holdings found</Text>
            )
          )}
        </View>
      )}
    </View>
  );
}

// Need React for useState
import React from "react";

const styles = StyleSheet.create({
  card: {
    borderRadius: tw.radius["2xl"],
    borderWidth: HAIRLINE,
    overflow: "hidden",
    marginBottom: tw.space[3],
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: tw.space[4],
    paddingVertical: tw.space[3],
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: tw.space[3],
    flex: 1,
    minWidth: 0,
  },
  invIconBox: {
    width: 32,
    height: 32,
    borderRadius: tw.radius.lg,
    alignItems: "center",
    justifyContent: "center",
  },
  headerMeta: {
    flex: 1,
    minWidth: 0,
  },
  headerNameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: tw.space[2],
    flexWrap: "wrap",
  },
  accountName: {
    ...tw.text.sm,
    fontWeight: tw.weight.semibold,
  },
  provBadge: {
    backgroundColor: tw.color.amber50,
    borderRadius: tw.radius.full,
    paddingHorizontal: tw.space[2],
    paddingVertical: 1,
  },
  provBadgeText: {
    ...tw.text["10"],
    fontWeight: tw.weight.semibold,
    color: tw.color.amber600,
    textTransform: "uppercase",
    letterSpacing: tw.tracking(tw.trackingEm.wide, 10),
  },
  accountType: {
    ...tw.text.xs,
    marginTop: 1,
  },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: tw.space[2],
    flexShrink: 0,
    marginLeft: tw.space[2],
  },
  totalValue: {
    ...tw.text.sm,
    fontWeight: tw.weight.bold,
  },
  expandedContent: {
    borderTopWidth: HAIRLINE,
    paddingHorizontal: tw.space[4],
    paddingVertical: tw.space[4],
    gap: tw.space[4],
  },
  actionBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  actionBtnRefresh: {
    flexDirection: "row",
    alignItems: "center",
    gap: tw.space[1.5],
  },
  actionBtnRefreshText: {
    color: tw.color.indigo600,
    ...tw.text.sm,
    fontWeight: tw.weight.semibold,
  },
  actionBtnDelete: {
    padding: tw.space[2],
  },
  decomposedLine: {
    ...tw.text.xs,
    lineHeight: 18,
  },
  infoBox: {
    borderRadius: tw.radius["2xl"],
    padding: tw.space[4],
    gap: tw.space[3],
  },
  infoBoxLabel: {
    ...tw.text["10"],
    fontWeight: tw.weight.semibold,
    textTransform: "uppercase",
    letterSpacing: tw.tracking(tw.trackingEm.wide, 10),
  },
  infoBoxBody: {
    ...tw.text.xs,
    lineHeight: 18,
  },
  uploadBtnRow: {
    flexDirection: "row",
    gap: tw.space[2],
    flexWrap: "wrap",
  },
  uploadBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: tw.space[1.5],
    paddingHorizontal: tw.space[3],
    paddingVertical: tw.space[2],
    borderRadius: tw.radius.xl,
    borderWidth: 1,
    backgroundColor: "transparent",
  },
  uploadBtnText: {
    ...tw.text.xs,
    fontWeight: tw.weight.semibold,
  },
  noteBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: tw.space[1.5],
    paddingHorizontal: tw.space[3],
    paddingVertical: tw.space[2],
    borderRadius: tw.radius.xl,
    backgroundColor: tw.color.indigo600,
  },
  noteBtnText: {
    color: tw.color.white,
    ...tw.text.xs,
    fontWeight: tw.weight.semibold,
  },
  noteForm: {
    gap: tw.space[3],
    marginTop: tw.space[1],
  },
  notePasswordRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  notePasswordInput: {
    flex: 1,
    ...tw.text.xs,
    borderWidth: 1,
    borderRadius: tw.radius.xl,
    paddingHorizontal: tw.space[3],
    paddingVertical: tw.space[2],
    paddingRight: tw.space[8],
  },
  eyeBtn: {
    position: "absolute",
    right: tw.space[3],
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
  errorText: {
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
  submitBtn: {
    backgroundColor: tw.color.indigo600,
    borderRadius: tw.radius["2xl"],
    paddingVertical: tw.space[2.5],
    alignItems: "center",
  },
  submitBtnText: {
    color: tw.color.white,
    ...tw.text.sm,
    fontWeight: tw.weight.semibold,
  },
  notesLoader: {
    marginVertical: tw.space[3],
  },
  notesSection: {
    gap: tw.space[2],
  },
  notesSectionLabel: {
    ...tw.text["10"],
    fontWeight: tw.weight.semibold,
    textTransform: "uppercase",
    letterSpacing: tw.tracking(tw.trackingEm.wide, 10),
  },
  notesCard: {
    borderRadius: tw.radius.xl,
    borderWidth: HAIRLINE,
    overflow: "hidden",
  },
  noteRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: tw.space[3],
    paddingVertical: tw.space[2.5],
  },
  noteRowLeft: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  noteDate: {
    ...tw.text.xs,
  },
  noteFund: {
    ...tw.text.xs,
    fontWeight: tw.weight.medium,
  },
  noteSoldBadge: {
    ...tw.text.xs,
  },
  noteAmount: {
    ...tw.text.xs,
    fontWeight: tw.weight.bold,
  },
  noteDeleteBtn: {
    padding: tw.space[1],
    marginLeft: tw.space[2],
  },
  showMoreBtn: {
    alignSelf: "flex-start",
  },
  showMoreText: {
    color: tw.color.indigo600,
    ...tw.text.xs,
    fontWeight: tw.weight.semibold,
  },
  supersededText: {
    ...tw.text.xs,
    fontStyle: "italic",
  },
  holdingsLoader: {
    marginVertical: tw.space[3],
  },
  holdingsSection: {
    borderRadius: tw.radius.xl,
    overflow: "hidden",
  },
  holdingRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    paddingHorizontal: tw.space[4],
    paddingVertical: tw.space[3],
    gap: tw.space[3],
  },
  holdingLeft: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  holdingName: {
    ...tw.text.xs,
    fontWeight: tw.weight.medium,
  },
  holdingMeta: {
    ...tw.text.xs,
  },
  holdingPrice: {
    ...tw.text.xs,
  },
  holdingValue: {
    ...tw.text.sm,
    fontWeight: tw.weight.bold,
    flexShrink: 0,
  },
  noHoldings: {
    ...tw.text.xs,
    textAlign: "center",
    paddingVertical: tw.space[4],
  },
});
