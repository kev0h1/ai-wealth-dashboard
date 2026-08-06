import React, { useEffect, useState, useCallback } from "react";
import {
  ScrollView,
  View,
  Text,
  Pressable,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { ChevronLeft, Play, Bell, Sparkles } from "lucide-react-native";
import { useTheme } from "@/lib/ThemeContext";
import { usePreferences } from "@/lib/PreferencesContext";
import { WhisperLabel, Skeleton, SegmentedControl } from "@/components/ui";
import { tw, HAIRLINE } from "@/lib/tw";
import { getCycleStoryFull, CycleStoryFull } from "@/lib/api/month";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
}

function fmtGBP(n: number) {
  return `£${Math.round(Math.abs(n)).toLocaleString("en-GB")}`;
}

function maskAmounts(text: string) {
  return text.replace(/£[\d,]+(\.\d+)?/g, "£••••");
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function MonthScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    persona?: string;
    preview?: string;
    which?: string;
  }>();

  const { dark } = useTheme();
  const { hideNetWorth } = usePreferences();

  const persona = params.persona ?? null;
  const isPreview = !persona && params.preview === "1";

  const [which, setWhich] = useState<"current" | "last">(
    params.which === "current" || persona || isPreview ? "current" : "last"
  );
  const [cache, setCache] = useState<
    Partial<Record<"current" | "last", CycleStoryFull>>
  >({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const story = cache[which];

  const fetchStory = useCallback(
    async (w: "current" | "last", force = false) => {
      if (!force && cache[w]) return;
      setLoading(true);
      setError(null);
      try {
        const data = await getCycleStoryFull(
          w,
          isPreview && !persona && w === "current",
          persona ?? undefined
        );
        setCache((prev) => ({ ...prev, [w]: data }));
      } catch {
        setError("Could not load your month.");
      } finally {
        setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isPreview, persona]
  );

  // Initial load logic
  useEffect(() => {
    if (persona) {
      fetchStory("current", true);
      return;
    }
    if (params.which === "current" || params.which === "last") {
      fetchStory(params.which as "current" | "last", true);
      return;
    }
    // Try last first; fall back to current if no data
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await getCycleStoryFull("last");
        if (data.status === "ok" && data.period) {
          setCache((prev) => ({ ...prev, last: data }));
          setWhich("last");
        } else {
          const cur = await getCycleStoryFull("current");
          setCache((prev) => ({ ...prev, current: cur }));
          setWhich("current");
        }
      } catch {
        try {
          const cur = await getCycleStoryFull("current");
          setCache((prev) => ({ ...prev, current: cur }));
          setWhich("current");
        } catch {
          setError("Could not load your month.");
        }
      } finally {
        setLoading(false);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSegmentChange = async (idx: number) => {
    const next: "current" | "last" = idx === 0 ? "current" : "last";
    setWhich(next);
    if (!cache[next]) {
      await fetchStory(next, true);
    }
  };

  // ─── Derived ──────────────────────────────────────────────────────────────

  const bg = dark ? tw.color.canvasDark : tw.color.canvasLight;
  const cardBg = dark ? tw.color.cardDark : tw.color.cardLight;
  const cardBorder = dark ? tw.color.cardBorderDark : tw.color.cardBorderLight;
  const narrativeColor = dark ? tw.color.slate200 : "#495057";
  const metricColor = dark ? tw.color.slate100 : tw.color.slate900;
  const divColor = dark ? "rgba(51,65,85,0.6)" : tw.color.slate100;
  const labelColor = tw.color.slate400;

  const fmt = hideNetWorth ? (n: number) => maskAmounts(fmtGBP(n)) : fmtGBP;
  const fmtText = (text: string) =>
    hideNetWorth ? maskAmounts(text) : text;

  const period = story?.period;
  const chapters = story?.chapters;
  const narrative = story?.narrative;

  const canPlayStory =
    story?.status === "ok" &&
    !story.early_days &&
    (persona || isPreview || (which === "last" && period?.closed));

  const storyHref = (() => {
    if (persona) return `/month/story?persona=${encodeURIComponent(persona)}`;
    if (isPreview) return "/month/story?preview=1";
    return "/month/story?which=last";
  })();

  // Card delta
  const closeDelta = chapters?.close?.card_delta ?? 0;
  const cardMovement =
    Math.abs(closeDelta) < 20
      ? "Held steady"
      : closeDelta <= -20
      ? `↓ ${fmtGBP(Math.abs(closeDelta))}`
      : `↑ ${fmtGBP(Math.abs(closeDelta))}`;
  const cardDeltaColor =
    closeDelta <= -20 && Math.abs(closeDelta) >= 20
      ? dark
        ? tw.color.emerald400
        : tw.color.emerald600
      : metricColor;

  // ─── Render helpers ───────────────────────────────────────────────────────

  const renderDivider = () => (
    <View
      style={{
        height: HAIRLINE,
        backgroundColor: divColor,
        marginVertical: 12,
      }}
    />
  );

  const renderMetricRow = (label: string, value: string, valueColor?: string) => (
    <View
      style={{
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        paddingVertical: 6,
      }}
    >
      <Text style={{ fontSize: 13, color: labelColor }}>{label}</Text>
      <Text
        style={{
          fontSize: 15,
          fontWeight: "600",
          color: valueColor ?? metricColor,
        }}
      >
        {value}
      </Text>
    </View>
  );

  const renderCard = (children: React.ReactNode) => (
    <View
      style={{
        backgroundColor: cardBg,
        borderRadius: tw.radius["2xl"],
        borderWidth: HAIRLINE,
        borderColor: cardBorder,
        padding: 16,
        marginTop: 12,
        shadowColor: "#000",
        shadowOpacity: dark ? 0 : 0.04,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 2 },
      }}
    >
      {children}
    </View>
  );

  const renderNarrative = (text: string) => (
    <Text
      style={{
        fontSize: 15,
        lineHeight: 22.5,
        color: narrativeColor,
        marginBottom: 12,
      }}
    >
      {fmtText(text)}
    </Text>
  );

  // ─── Main render ──────────────────────────────────────────────────────────

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: bg }}
      contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 144 }}
      showsVerticalScrollIndicator={false}
    >
      {/* Header */}
      <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 8, gap: 8 }}>
        <Pressable
          onPress={() => router.back()}
          style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 4 }}
          accessibilityLabel="Back"
        >
          <ChevronLeft size={15} color={tw.color.slate400} />
          <Text style={{ fontSize: 14, color: tw.color.slate400 }}>Back</Text>
        </Pressable>
        {persona ? (
          <View
            style={{
              backgroundColor: "rgba(139,92,246,0.1)",
              borderWidth: 1,
              borderColor: "rgba(139,92,246,0.3)",
              borderRadius: 20,
              paddingHorizontal: 10,
              paddingVertical: 3,
            }}
          >
            <Text style={{ fontSize: 11, color: "#c4b5fd", fontWeight: "600" }}>
              DEMO · {persona}
            </Text>
          </View>
        ) : isPreview ? (
          <View
            style={{
              backgroundColor: "rgba(245,158,11,0.1)",
              borderWidth: 1,
              borderColor: "rgba(245,158,11,0.3)",
              borderRadius: 20,
              paddingHorizontal: 10,
              paddingVertical: 3,
            }}
          >
            <Text style={{ fontSize: 11, color: tw.color.amber300, fontWeight: "600" }}>
              PREVIEW
            </Text>
          </View>
        ) : null}
      </View>

      {/* Preview demo links */}
      {isPreview && (
        <View style={{ flexDirection: "row", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
          {["comfortable", "breakeven", "partial"].map((p) => (
            <Pressable
              key={p}
              onPress={() => router.push(`/month/story?persona=${p}` as never)}
              style={{
                backgroundColor: "rgba(139,92,246,0.08)",
                borderWidth: 1,
                borderColor: "rgba(139,92,246,0.2)",
                borderRadius: 20,
                paddingHorizontal: 10,
                paddingVertical: 4,
              }}
            >
              <Text style={{ fontSize: 12, color: "#c4b5fd" }}>
                Demo: {p}
              </Text>
            </Pressable>
          ))}
        </View>
      )}

      <WhisperLabel>YOUR MONTH</WhisperLabel>

      {period && (
        <Text style={{ fontSize: 14, color: tw.color.slate400, marginBottom: 8 }}>
          {fmtDate(period.start)} – {fmtDate(period.end)}
        </Text>
      )}

      {/* Segment control */}
      {!persona && (
        <View style={{ marginBottom: 16 }}>
          <SegmentedControl
            options={["This cycle", "Last cycle"]}
            selected={which === "current" ? 0 : 1}
            onChange={handleSegmentChange}
          />
        </View>
      )}

      {/* Play button */}
      {canPlayStory && (
        <Pressable
          onPress={() => router.push(storyHref as never)}
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            borderRadius: 999,
            paddingVertical: 12,
            paddingHorizontal: 24,
            backgroundColor: dark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)",
            borderWidth: 1,
            borderColor: dark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.08)",
            marginBottom: 24,
          }}
          accessibilityLabel="Play your month"
        >
          <Play
            size={16}
            color={dark ? tw.color.slate100 : tw.color.slate900}
            fill={dark ? tw.color.slate100 : tw.color.slate900}
          />
          <Text
            style={{
              fontSize: 14,
              fontWeight: "600",
              color: dark ? tw.color.slate100 : tw.color.slate900,
            }}
          >
            Play your month
          </Text>
        </Pressable>
      )}

      {/* HOW TOMORROW ARRIVES — preview mode only, per spec */}
      {!loading && !persona && isPreview && story?.tomorrow && (
        <>
          <WhisperLabel style={{ marginBottom: 8 }}>HOW TOMORROW ARRIVES</WhisperLabel>
          {renderCard(
            <>
              {/* Push notification mock */}
              <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
                <Bell size={16} color={tw.color.slate400} style={{ marginTop: 2 }} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14, fontWeight: "600", color: metricColor, marginBottom: 2 }}>
                    {story.tomorrow.push_title}
                  </Text>
                  <Text style={{ fontSize: 12, color: tw.color.slate500 }}>
                    {story.tomorrow.push_body}
                  </Text>
                </View>
              </View>
              {/* Divider */}
              <View style={{ height: HAIRLINE, backgroundColor: divColor, marginVertical: 12 }} />
              {/* Brief companion mock */}
              <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
                <Sparkles size={16} color={tw.color.slate400} style={{ marginTop: 2 }} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14, fontWeight: "600", color: metricColor, marginBottom: 2 }}>
                    {story.tomorrow.brief_headline}
                  </Text>
                  <Text style={{ fontSize: 12, color: tw.color.slate500 }}>
                    {story.tomorrow.brief_body}
                  </Text>
                </View>
              </View>
            </>
          )}
          <Text style={{ fontSize: 10, color: tw.color.slate400, marginTop: 6, marginBottom: 20 }}>
            Purely illustrative — based on today's figures.
          </Text>
        </>
      )}

      {/* Loading */}
      {loading && (
        <>
          <Skeleton style={{ height: 80, borderRadius: 16, marginBottom: 16 }} />
          <Skeleton style={{ height: 80, borderRadius: 16, marginBottom: 16 }} />
          <Skeleton style={{ height: 80, borderRadius: 16, marginBottom: 16 }} />
        </>
      )}

      {/* Error / no data */}
      {!loading && (error || !story || story.status !== "ok") &&
        renderCard(
          <Text style={{ fontSize: 15, color: tw.color.slate400, textAlign: "center" }}>
            {error ?? "Nothing to tell yet."}
          </Text>
        )
      }

      {/* Data */}
      {!loading && story?.status === "ok" && (
        <>
          {/* Chapter 1 — THE OPENING */}
          <WhisperLabel style={{ marginTop: 8 }}>THE OPENING</WhisperLabel>
          {narrative?.opening && renderNarrative(narrative.opening)}
          {chapters?.opening &&
            renderCard(
              <View style={{ flexDirection: "row", gap: 16 }}>
                <View style={{ flex: 1 }}>
                  <Text
                    style={{
                      fontSize: 11,
                      color: labelColor,
                      textTransform: "uppercase",
                      marginBottom: 4,
                    }}
                  >
                    Income in
                  </Text>
                  <Text style={{ fontSize: 18, fontWeight: "700", color: metricColor }}>
                    {fmt(chapters.opening.income_in)}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text
                    style={{
                      fontSize: 11,
                      color: labelColor,
                      textTransform: "uppercase",
                      marginBottom: 4,
                    }}
                  >
                    Deposits
                  </Text>
                  <Text style={{ fontSize: 18, fontWeight: "700", color: metricColor }}>
                    {chapters.opening.count}
                  </Text>
                </View>
              </View>
            )}

          {/* Early days gate */}
          {story.early_days ? (
            renderCard(
              <>
                <WhisperLabel>EARLY DAYS</WhisperLabel>
                {narrative?.month && renderNarrative(narrative.month)}
                <Pressable
                  onPress={() => {
                    setWhich("last");
                    fetchStory("last", true);
                  }}
                >
                  <Text style={{ fontSize: 14, color: tw.color.indigo600, fontWeight: "600" }}>
                    Read last month ›
                  </Text>
                </Pressable>
              </>
            )
          ) : (
            <>
              {/* Chapter 2 — THE SPENDING */}
              <WhisperLabel style={{ marginTop: 20 }}>THE SPENDING</WhisperLabel>
              {narrative?.month && renderNarrative(narrative.month)}
              {(chapters?.spending || chapters?.cliff) &&
                renderCard(
                  <>
                    {chapters.spending &&
                      renderMetricRow("Total spend", fmt(chapters.spending.total_spend))}
                    {chapters.spending &&
                      renderMetricRow("Income in", fmt(chapters.spending.income_in))}
                    {chapters.cliff &&
                      renderMetricRow(
                        "Week 1 share",
                        `${Math.round(chapters.cliff.week1_pct)}%`
                      )}
                    {chapters.spending?.top_categories?.length ? (
                      <>
                        {renderDivider()}
                        {chapters.spending.top_categories.slice(0, 5).map((cat, i) => (
                          <React.Fragment key={cat.category}>
                            {i > 0 && renderDivider()}
                            <View
                              style={{
                                flexDirection: "row",
                                justifyContent: "space-between",
                                alignItems: "center",
                                paddingVertical: 4,
                              }}
                            >
                              <Text style={{ flex: 1, fontSize: 14, color: narrativeColor }}>
                                {cat.category}
                              </Text>
                              <Text
                                style={{ fontSize: 14, fontWeight: "600", color: metricColor }}
                              >
                                {fmt(cat.total)}
                              </Text>
                            </View>
                          </React.Fragment>
                        ))}
                      </>
                    ) : null}
                    {chapters.cards?.material && (
                      <>
                        {renderDivider()}
                        <Text style={{ fontSize: 14, color: narrativeColor, marginBottom: 4 }}>
                          {fmt(chapters.cards.new_spend)} of it rode on your cards.
                        </Text>
                        <Text style={{ fontSize: 14, color: cardDeltaColor }}>
                          {cardMovement}
                        </Text>
                        {chapters.switch?.switch_day && (
                          <Text style={{ fontSize: 13, color: labelColor, marginTop: 4 }}>
                            Cards took over from cash on {fmtDate(chapters.switch.switch_day)}.
                          </Text>
                        )}
                        <Pressable
                          onPress={() => router.push("/cards" as never)}
                          style={{ marginTop: 8 }}
                        >
                          <Text style={{ fontSize: 14, color: tw.color.indigo600, fontWeight: "600" }}>
                            The cards chapter ›
                          </Text>
                        </Pressable>
                      </>
                    )}
                  </>
                )}

              {/* Chapter 3 — THE MOVES */}
              <WhisperLabel style={{ marginTop: 20 }}>THE MOVES</WhisperLabel>
              {narrative?.moves && renderNarrative(narrative.moves)}
              {chapters?.moves &&
                renderCard(
                  <>
                    {(() => {
                      const moveKeys = [
                        "ritual_saving",
                        "deliberate_saving",
                        "card_feeding",
                        "buffer_draws",
                        "other_shuffles",
                      ] as const;
                      const moveLabels: Record<string, string> = {
                        ritual_saving: "Ritual saving",
                        deliberate_saving: "Deliberate saving",
                        card_feeding: "Card feeding",
                        buffer_draws: "Buffer draws",
                        other_shuffles: "Other shuffles",
                      };
                      const active = moveKeys.filter(
                        (k) => chapters.moves[k]?.count > 0
                      );
                      if (!active.length) {
                        return (
                          <Text style={{ fontSize: 14, color: tw.color.slate400 }}>
                            No transfers this cycle.
                          </Text>
                        );
                      }
                      return active.map((k, i) => (
                        <React.Fragment key={k}>
                          {i > 0 && renderDivider()}
                          {renderMetricRow(
                            `${moveLabels[k]} (${chapters.moves[k].count}×)`,
                            fmt(chapters.moves[k].total)
                          )}
                        </React.Fragment>
                      ));
                    })()}
                  </>
                )}

              {/* Chapter 4 — THE KEEPING */}
              <WhisperLabel style={{ marginTop: 20 }}>THE KEEPING</WhisperLabel>
              {narrative?.keeping && renderNarrative(narrative.keeping)}
              {chapters?.keeping &&
                renderCard(
                  <>
                    {renderMetricRow("Set aside", fmt(chapters.keeping.set_aside))}
                    {renderMetricRow("Drawn back", fmt(chapters.keeping.drawn_back))}
                    {chapters.keeping.external > 0 &&
                      renderMetricRow("To investments", fmt(chapters.keeping.external))}
                  </>
                )}

              {/* Chapter 5 — THE CLOSE */}
              <WhisperLabel style={{ marginTop: 20 }}>THE CLOSE</WhisperLabel>
              {narrative?.close && renderNarrative(narrative.close)}
              {chapters?.close &&
                renderCard(
                  <>
                    {renderMetricRow(
                      "Month-end cash",
                      fmt(chapters.close.month_end_cash)
                    )}
                    {chapters.cards?.material &&
                      renderMetricRow("Card movement", cardMovement, cardDeltaColor)}
                    {chapters.close.streak_weeks != null &&
                      renderMetricRow("Streak", `${chapters.close.streak_weeks}w`)}
                  </>
                )}

              {/* Chapter 6 — THE SELF */}
              <WhisperLabel style={{ marginTop: 20 }}>THE SELF</WhisperLabel>
              {narrative?.self && renderNarrative(narrative.self)}
            </>
          )}
        </>
      )}
    </ScrollView>
  );
}
