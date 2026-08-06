import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  Pressable,
  Linking,
  StyleSheet,
} from "react-native";
import { Bookmark, BookmarkCheck, CheckCircle2, Sparkles, ExternalLink } from "lucide-react-native";
import { useTheme } from "@/lib/ThemeContext";
import { tw } from "@/lib/tw";
import { fmtGBP } from "@/lib/format";
import { api } from "@/lib/api";
import { WorkflowDrawer } from "@/components/insights/WorkflowDrawer";
import type { WorkflowDef } from "@/lib/api/insights";

export type FullInsight = {
  id: string;
  title: string;
  body?: string;
  rationale?: string;
  action?: string;
  impact?: number;
  category: string;
  pinned?: boolean;
  is_new?: boolean;
  verified_saving?: number;
  triggered_by?: string;
  created_at?: string;
  workflow_key?: string;
  deal_sites?: { name: string; url: string }[];
};

interface Props {
  insight: FullInsight;
  workflows: Record<string, WorkflowDef>;
  onPinToggle?: (id: string, pinned: boolean) => void;
}

function daysSince(dateStr: string): number {
  const d = new Date(dateStr);
  const now = new Date();
  return Math.floor((now.getTime() - d.getTime()) / 86400000);
}

export function InsightCard({ insight, workflows, onPinToggle }: Props) {
  const { dark } = useTheme();
  const [expanded, setExpanded] = useState(false);
  const [pinned, setPinned] = useState(insight.pinned ?? false);
  const [pinning, setPinning] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const body = insight.body ?? insight.rationale ?? "";
  const bodyTruncatable = body.length > 140;
  const displayBody = expanded || !bodyTruncatable ? body : `${body.slice(0, 140)}…`;

  const daysAgo =
    insight.created_at ? daysSince(insight.created_at) : null;
  const isRecent = daysAgo !== null && daysAgo <= 14;

  const cardBg = dark ? tw.color.cardDark : tw.color.white;
  const cardBorder = dark ? tw.color.cardBorderDark : tw.color.cardBorderLight;
  const textPrimary = dark ? tw.color.slate100 : tw.color.slate800;
  const textSecondary = dark ? tw.color.slate400 : tw.color.slate600;

  const handlePin = useCallback(async () => {
    if (pinning) return;
    setPinning(true);
    const next = !pinned;
    setPinned(next);
    try {
      await api.pinSavingsInsight(insight.id);
      onPinToggle?.(insight.id, next);
    } catch {
      setPinned(!next);
    } finally {
      setPinning(false);
    }
  }, [pinning, pinned, insight.id, onPinToggle]);

  return (
    <>
      <View
        style={[
          styles.card,
          {
            backgroundColor: cardBg,
            borderColor: cardBorder,
          },
        ]}
      >
        {/* Top row: badges + pin */}
        <View style={styles.topRow}>
          <View style={styles.badgeRow}>
            <View style={styles.categoryBadge}>
              <Text style={styles.categoryText}>
                {insight.category}
              </Text>
            </View>
            {insight.is_new && (
              <View style={styles.newBadge}>
                <Sparkles size={10} color={tw.color.violet600} />
                <Text style={styles.newBadgeText}>New</Text>
              </View>
            )}
          </View>
          <Pressable
            onPress={handlePin}
            hitSlop={8}
            style={styles.pinBtn}
            accessibilityLabel={pinned ? "Unpin insight" : "Pin insight"}
          >
            {pinned ? (
              <BookmarkCheck size={18} color={tw.color.indigo500} />
            ) : (
              <Bookmark size={18} color={tw.color.slate400} />
            )}
          </Pressable>
        </View>

        {/* Title */}
        <Text style={[styles.title, { color: textPrimary }]}>
          {insight.title}
        </Text>

        {/* Body */}
        {body.length > 0 && (
          <View>
            <Text style={[styles.body, { color: textSecondary }]}>
              {displayBody}
            </Text>
            {bodyTruncatable && (
              <Pressable onPress={() => setExpanded((e) => !e)}>
                <Text style={styles.toggleLink}>
                  {expanded ? "less" : "more"}
                </Text>
              </Pressable>
            )}
          </View>
        )}

        {/* Verified saving banner */}
        {insight.verified_saving != null && insight.verified_saving > 0 && (
          <View style={styles.verifiedBanner}>
            <CheckCircle2 size={14} color={tw.color.emerald600} style={styles.verifiedIcon} />
            <Text style={styles.verifiedText}>
              You did it — payments{insight.triggered_by ? ` to ${insight.triggered_by}` : ""} have stopped. That's ~{fmtGBP(insight.verified_saving)}/mo staying in your pocket.
            </Text>
          </View>
        )}

        {/* Time label */}
        {isRecent && daysAgo !== null && (
          <Text style={[styles.timeLabel, { color: textSecondary }]}>
            {daysAgo === 0 ? "Today" : daysAgo === 1 ? "Yesterday" : `${daysAgo} days ago`}
          </Text>
        )}

        {/* Deal sites */}
        {insight.deal_sites && insight.deal_sites.length > 0 && (
          <View style={styles.dealRow}>
            {insight.deal_sites.slice(0, 2).map((site) => (
              <Pressable
                key={site.url}
                onPress={() => Linking.openURL(site.url)}
                style={styles.dealChip}
              >
                <ExternalLink size={12} color={tw.color.indigo600} />
                <Text style={styles.dealChipText}>{site.name}</Text>
              </Pressable>
            ))}
          </View>
        )}

        {/* Workflow CTA */}
        {insight.workflow_key && workflows[insight.workflow_key] && (
          <Pressable
            onPress={() => setDrawerOpen(true)}
            style={styles.actionBtn}
          >
            <Text style={styles.actionBtnText}>Take action</Text>
          </Pressable>
        )}
      </View>

      {insight.workflow_key && (
        <WorkflowDrawer
          visible={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          insightId={insight.id}
          workflowKey={insight.workflow_key}
          workflows={workflows}
        />
      )}
    </>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: tw.radius["2xl"],
    borderWidth: 1,
    marginHorizontal: tw.space[4],
    marginBottom: tw.space[3],
    padding: tw.space[4],
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
    gap: tw.space[2],
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  badgeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: tw.space[2],
    flex: 1,
  },
  categoryBadge: {
    backgroundColor: tw.color.slate100,
    borderRadius: tw.radius.full,
    paddingHorizontal: tw.space[2],
    paddingVertical: 3,
  },
  categoryText: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: tw.weight.semibold,
    color: tw.color.slate600,
    textTransform: "uppercase",
    letterSpacing: tw.tracking(tw.trackingEm.widest, 11),
  },
  newBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: tw.color.violet50,
    borderRadius: tw.radius.full,
    paddingHorizontal: tw.space[2],
    paddingVertical: 3,
  },
  newBadgeText: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: tw.weight.semibold,
    color: tw.color.violet600,
  },
  pinBtn: {
    padding: tw.space[1],
  },
  title: {
    ...tw.text.base,
    fontWeight: tw.weight.bold,
  },
  body: {
    ...tw.text.sm,
  },
  toggleLink: {
    ...tw.text.sm,
    color: tw.color.indigo600,
    fontWeight: tw.weight.medium,
    marginTop: 2,
  },
  verifiedBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: tw.space[2],
    backgroundColor: tw.color.emerald50,
    borderRadius: tw.radius.lg,
    paddingHorizontal: tw.space[3],
    paddingVertical: tw.space[2],
    borderWidth: 1,
    borderColor: tw.color.emerald200,
  },
  verifiedIcon: {
    marginTop: 2,
    flexShrink: 0,
  },
  verifiedText: {
    ...tw.text.sm,
    fontWeight: tw.weight.medium,
    color: tw.color.emerald600,
    flex: 1,
  },
  timeLabel: {
    ...tw.text["11"],
  },
  dealRow: {
    flexDirection: "row",
    gap: tw.space[2],
    flexWrap: "wrap",
  },
  dealChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: tw.space[1],
    backgroundColor: tw.color.indigo50,
    borderRadius: tw.radius.full,
    paddingHorizontal: tw.space[3],
    paddingVertical: tw.space[1],
    borderWidth: 1,
    borderColor: tw.color.indigo200,
  },
  dealChipText: {
    ...tw.text.xs,
    fontWeight: tw.weight.medium,
    color: tw.color.indigo600,
  },
  actionBtn: {
    backgroundColor: tw.color.indigo600,
    borderRadius: tw.radius.xl,
    paddingVertical: tw.space[2],
    paddingHorizontal: tw.space[4],
    alignItems: "center",
    alignSelf: "flex-start",
    marginTop: tw.space[1],
  },
  actionBtnText: {
    ...tw.text.sm,
    fontWeight: tw.weight.semibold,
    color: tw.color.white,
  },
});
