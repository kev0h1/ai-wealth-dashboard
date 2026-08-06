/**
 * InvestmentUploadSheet — bottom sheet for uploading an investment statement PDF.
 * Uses expo-document-picker. Sends to /investment/upload via accountsApi.uploadInvestmentStatement.
 */

import React, { useState } from "react";
import {
  View, Text, Pressable, StyleSheet, TextInput, ActivityIndicator,
} from "react-native";
import { Upload, TrendingUp, Eye, EyeOff, CheckCircle, X } from "lucide-react-native";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { tw, HAIRLINE } from "@/lib/tw";

const EXT = { rose500: "#f43f5e" } as const;
import { accountsApi } from "@/lib/api/accounts";
import type { RNFile } from "@/lib/api/accounts";

interface InvestmentUploadSheetProps {
  visible: boolean;
  onClose: () => void;
  onSuccess: () => void;
  dark: boolean;
}

export function InvestmentUploadSheet({
  visible,
  onClose,
  onSuccess,
  dark,
}: InvestmentUploadSheetProps) {
  const ink = dark ? tw.color.slate100 : tw.color.slate900;
  const muted = tw.color.slate400;
  const subMuted = dark ? tw.color.slate400 : tw.color.slate600;

  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [selectedFile, setSelectedFile] = useState<RNFile | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    provider: string;
    account_type: string;
    total_value: number;
    holdings_count: number;
  } | null>(null);

  function reset() {
    setPassword("");
    setShowPassword(false);
    setSelectedFile(null);
    setUploading(false);
    setError(null);
    setResult(null);
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function pickFile() {
    try {
      const { getDocumentAsync } = await import("expo-document-picker");
      const res = await getDocumentAsync({
        type: "application/pdf",
        copyToCacheDirectory: true,
      });
      if (!res.canceled && res.assets?.[0]) {
        const asset = res.assets[0];
        setSelectedFile({
          uri: asset.uri,
          name: asset.name,
          mimeType: asset.mimeType ?? "application/pdf",
        });
        setError(null);
      }
    } catch {
      setError("Could not open file picker");
    }
  }

  async function handleSubmit() {
    if (!selectedFile || uploading) return;
    setUploading(true);
    setError(null);
    try {
      const res = await accountsApi.uploadInvestmentStatement(selectedFile, password || undefined);
      setResult(res);
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  return (
    <BottomSheet visible={visible} onClose={handleClose}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={[styles.title, { color: ink }]}>Upload Investment Statement</Text>
          <Text style={[styles.subtitle, { color: muted }]}>
            Vanguard, Wealthify, Hargreaves Lansdown, Fidelity, AJ Bell and more
          </Text>
        </View>
        <Pressable
          onPress={handleClose}
          style={({ pressed }) => [
            styles.closeBtn,
            { opacity: pressed ? 0.6 : 1, backgroundColor: dark ? tw.color.slate700 : tw.color.slate100 },
          ]}
          accessibilityLabel="Close"
        >
          <X size={15} color={muted} />
        </Pressable>
      </View>

      {result ? (
        /* Success state */
        <View style={styles.successContainer}>
          <CheckCircle size={40} color={tw.color.emerald500} />
          <Text style={[styles.successHeading, { color: ink }]}>
            {result.provider} {result.account_type} imported
          </Text>
          <Text style={[styles.successMeta, { color: muted }]}>
            {result.holdings_count} holding{result.holdings_count !== 1 ? "s" : ""} ·{" "}
            £{result.total_value.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </Text>
          <Pressable
            onPress={handleClose}
            style={({ pressed }) => [styles.doneBtn, { opacity: pressed ? 0.8 : 1 }]}
          >
            <Text style={styles.doneBtnText}>Done</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.form}>
          {/* Password */}
          <View style={styles.fieldGroup}>
            <Text style={[styles.fieldLabel, { color: subMuted }]}>
              Password{" "}
              <Text style={[styles.fieldLabelNote, { color: muted }]}>(if PDF is protected)</Text>
            </Text>
            <View style={styles.passwordRow}>
              <TextInput
                style={[styles.input, {
                  backgroundColor: dark ? tw.color.slate700 : tw.color.slate50,
                  borderColor: dark ? tw.color.slate600 : tw.color.slate200,
                  color: ink,
                }]}
                placeholder="Leave blank if not password-protected"
                placeholderTextColor={muted}
                secureTextEntry={!showPassword}
                value={password}
                onChangeText={setPassword}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <Pressable
                onPress={() => setShowPassword(v => !v)}
                style={styles.eyeBtn}
                accessibilityLabel={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff size={15} color={muted} /> : <Eye size={15} color={muted} />}
              </Pressable>
            </View>
          </View>

          {/* File picker */}
          <View style={styles.fieldGroup}>
            <Text style={[styles.fieldLabel, { color: subMuted }]}>Statement file</Text>
            <Pressable
              onPress={pickFile}
              style={[
                styles.filePicker,
                { borderColor: dark ? tw.color.slate600 : tw.color.slate200 },
              ]}
            >
              <View style={[styles.fileIconBox, { backgroundColor: dark ? tw.color.indigo900 : tw.color.indigo50 }]}>
                {selectedFile
                  ? <TrendingUp size={20} color={tw.color.indigo600} />
                  : <Upload size={20} color={tw.color.indigo400} />}
              </View>
              <View style={styles.fileInfo}>
                {selectedFile ? (
                  <>
                    <Text style={[styles.fileName, { color: ink }]} numberOfLines={1}>
                      {selectedFile.name}
                    </Text>
                    <Text style={[styles.fileMeta, { color: muted }]}>Tap to change</Text>
                  </>
                ) : (
                  <>
                    <Text style={[styles.filePlaceholder, { color: muted }]}>Tap to choose a file</Text>
                    <Text style={[styles.fileMeta, { color: muted }]}>.pdf</Text>
                  </>
                )}
              </View>
            </Pressable>
          </View>

          {/* Error */}
          {error && (
            <View style={[
              styles.errorBox,
              { backgroundColor: dark ? tw.color.slate800 : tw.color.slate50, borderColor: dark ? tw.color.rose700 : tw.color.rose300 },
            ]}>
              <Text style={[styles.errorLabel, { color: EXT.rose500 }]}>Upload failed</Text>
              <Text style={[styles.errorText, { color: EXT.rose500 }]}>{error}</Text>
            </View>
          )}

          {/* Submit */}
          <Pressable
            onPress={handleSubmit}
            disabled={!selectedFile || uploading}
            style={({ pressed }) => [
              styles.submitBtn,
              { opacity: (!selectedFile || uploading || pressed) ? 0.4 : 1 },
            ]}
          >
            {uploading ? (
              <>
                <ActivityIndicator size="small" color={tw.color.white} />
                <Text style={styles.submitBtnText}>Analysing holdings…</Text>
              </>
            ) : (
              <>
                <Upload size={16} color={tw.color.white} />
                <Text style={styles.submitBtnText}>Import Statement</Text>
              </>
            )}
          </Pressable>
        </View>
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
    paddingBottom: tw.space[5],
  },
  headerText: {
    flex: 1,
    marginRight: tw.space[3],
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
  form: {
    gap: tw.space[4],
    paddingHorizontal: tw.space[1],
  },
  fieldGroup: {
    gap: tw.space[1.5],
  },
  fieldLabel: {
    ...tw.text.xs,
    fontWeight: tw.weight.semibold,
  },
  fieldLabelNote: {
    fontWeight: "400" as const,
  },
  passwordRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  input: {
    flex: 1,
    ...tw.text.sm,
    borderWidth: 1,
    borderRadius: tw.radius.xl,
    paddingHorizontal: tw.space[3],
    paddingVertical: tw.space[2.5],
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
    gap: tw.space[3],
    borderWidth: 2,
    borderStyle: "dashed",
    borderRadius: tw.radius["2xl"],
    padding: tw.space[5],
  },
  fileIconBox: {
    width: 40,
    height: 40,
    borderRadius: tw.radius.xl,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  fileInfo: {
    flex: 1,
    minWidth: 0,
  },
  fileName: {
    ...tw.text.sm,
    fontWeight: tw.weight.semibold,
  },
  filePlaceholder: {
    ...tw.text.sm,
    fontWeight: tw.weight.semibold,
  },
  fileMeta: {
    ...tw.text.xs,
    marginTop: 2,
  },
  errorBox: {
    borderRadius: tw.radius.xl,
    borderWidth: HAIRLINE,
    paddingHorizontal: tw.space[4],
    paddingVertical: tw.space[3],
    gap: 2,
  },
  errorLabel: {
    ...tw.text.xs,
    fontWeight: tw.weight.semibold,
  },
  errorText: {
    ...tw.text.xs,
  },
  submitBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: tw.space[2],
    backgroundColor: tw.color.indigo600,
    borderRadius: tw.radius["2xl"],
    paddingVertical: tw.space[3],
  },
  submitBtnText: {
    color: tw.color.white,
    ...tw.text.sm,
    fontWeight: tw.weight.semibold,
  },
  successContainer: {
    alignItems: "center",
    gap: tw.space[3],
    paddingVertical: tw.space[8],
    paddingHorizontal: tw.space[1],
  },
  successHeading: {
    ...tw.text.sm,
    fontWeight: tw.weight.semibold,
    textAlign: "center",
  },
  successMeta: {
    ...tw.text.xs,
    textAlign: "center",
  },
  doneBtn: {
    marginTop: tw.space[2],
    backgroundColor: tw.color.indigo600,
    borderRadius: tw.radius.xl,
    paddingHorizontal: tw.space[6],
    paddingVertical: tw.space[2.5],
  },
  doneBtnText: {
    color: tw.color.white,
    ...tw.text.sm,
    fontWeight: tw.weight.semibold,
  },
});
