"use client";

// Shared data hook for the /design/v* Home-top variant previews.
// Fetches exactly what the real HomePage fetches for its top section,
// written once so all three variants share one loader.

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { KPIs, SafeToSpend, CompanionItem, GoalSummary, ValueDelivered } from "@/lib/api";
import { useAuth } from "@/components/AuthProvider";

export interface HomeTopData {
  loading: boolean;
  kpis: KPIs | null;
  safeToSpend: SafeToSpend | null;
  companionItems: CompanionItem[];
  goals: GoalSummary[];
  goalsStatus: "loading" | "ready" | "failed";
  valueDelivered: ValueDelivered | null;
  firstName?: string;
  reload: () => void;
}

export function useHomeTopData(): HomeTopData {
  const { user } = useAuth();
  const firstName = user?.name?.split(" ")[0]?.trim();
  const [loading, setLoading] = useState(true);
  const [kpis, setKpis] = useState<KPIs | null>(null);
  const [safeToSpend, setSafeToSpend] = useState<SafeToSpend | null>(null);
  const [companionItems, setCompanionItems] = useState<CompanionItem[]>([]);
  const [goals, setGoals] = useState<GoalSummary[]>([]);
  const [goalsStatus, setGoalsStatus] = useState<"loading" | "ready" | "failed">("loading");
  const [valueDelivered, setValueDelivered] = useState<ValueDelivered | null>(null);

  const reload = useCallback(() => {
    setLoading(true);
    setGoalsStatus("loading");
    Promise.allSettled([
      api.kpis(),
      api.safeToSpend(),
      api.getToday(),
      api.goalsSummary(),
      api.valueDelivered(),
    ]).then(([kpiR, safeR, todayR, goalsR, valueR]) => {
      if (kpiR.status === "fulfilled") setKpis(kpiR.value);
      if (safeR.status === "fulfilled") setSafeToSpend(safeR.value);
      if (todayR.status === "fulfilled") setCompanionItems(todayR.value.items);
      if (goalsR.status === "fulfilled") { setGoals(goalsR.value.goals); setGoalsStatus("ready"); }
      else setGoalsStatus("failed");
      if (valueR.status === "fulfilled") setValueDelivered(valueR.value);
      setLoading(false);
    });
  }, []);

  useEffect(() => { reload(); }, [reload]);

  return { loading, kpis, safeToSpend, companionItems, goals, goalsStatus, valueDelivered, firstName, reload };
}
