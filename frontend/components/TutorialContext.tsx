"use client";

import { createContext, useContext, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";

export interface TutorialStep {
  id: string;
  route: string | null;
  target: string | null;
  tooltipSide: "above" | "below" | "center";
  iconName: string;
  color: string;
  bg: string;
  title: string;
  description: string;
  tip?: string;
}

export const TUTORIAL_STEPS: TutorialStep[] = [
  {
    id: "welcome",
    route: null,
    target: null,
    tooltipSide: "center",
    iconName: "Sparkles",
    color: "#4f46e5",
    bg: "#ede9fe",
    title: "Welcome to Wealth Dashboard",
    description: "Track all your money in one place. This short tour will walk you through the key features — tap Next to get started.",
  },
  {
    id: "manage-accounts",
    route: "/",
    target: "tutorial-manage-link",
    tooltipSide: "below",
    iconName: "Building2",
    color: "#2563eb",
    bg: "#dbeafe",
    title: "Open Your Accounts",
    description: "Tap Manage to go to the Accounts page, where you can connect a bank via open banking or upload a bank statement.",
  },
  {
    id: "add-account",
    route: "/accounts",
    target: "tutorial-add-account",
    tooltipSide: "below",
    iconName: "Building2",
    color: "#2563eb",
    bg: "#dbeafe",
    title: "Connect Open Banking",
    description: "Tap Add Bank to securely link your account. Your transactions will sync automatically from that point on.",
    tip: "Supports most UK banks via TrueLayer and Yapily.",
  },
  {
    id: "upload-statement",
    route: "/accounts",
    target: "tutorial-upload-statement",
    tooltipSide: "below",
    iconName: "Upload",
    color: "#0891b2",
    bg: "#cffafe",
    title: "Upload a Statement",
    description: "If your bank isn't supported for open banking, export a CSV from your bank's website and upload it here instead.",
    tip: "Works with NatWest, Barclays, HSBC, Monzo and more.",
  },
  {
    id: "view-spending",
    route: "/spend",
    target: null,
    tooltipSide: "center",
    iconName: "PieChart",
    color: "#0891b2",
    bg: "#cffafe",
    title: "View Your Spending",
    description: "The Spend page breaks down your outgoings by category for the current pay period. Tap any category to see the individual transactions, and tap a transaction to change its category.",
    tip: "Go to Settings → Rules to auto-categorise merchants in future.",
  },
  {
    id: "create-budget",
    route: "/budget",
    target: "tutorial-budget-add",
    tooltipSide: "above",
    iconName: "Target",
    color: "#059669",
    bg: "#d1fae5",
    title: "Add a Budget Manually",
    description: "Choose a category, enter a monthly limit, then tap the + button to save it. Your spend will be tracked against this limit each pay period.",
    tip: "Example: category \"Eating Out\", limit £200.",
  },
  {
    id: "budget-ai",
    route: "/budget",
    target: "tutorial-budget-chat",
    tooltipSide: "center",
    iconName: "Sparkles",
    color: "#059669",
    bg: "#d1fae5",
    title: "Or Use the AI Advisor",
    description: "Tap the green chat button to open the AI Budget Advisor. Describe what you want in plain English and it will create budgets for you automatically.",
    tip: "Example: \"Limit eating out to £200 per month\".",
  },
];

interface TutorialContextType {
  isActive: boolean;
  currentStep: number;
  total: number;
  step: TutorialStep;
  start: () => void;
  next: () => void;
  prev: () => void;
  goTo: (n: number) => void;
  end: () => void;
}

const Ctx = createContext<TutorialContextType | null>(null);

export function TutorialProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [isActive, setIsActive] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const navigatingRef = useRef(false);

  const navigateTo = useCallback((n: number) => {
    const s = TUTORIAL_STEPS[n];
    if (s?.route) {
      navigatingRef.current = true;
      router.push(s.route);
    }
    setCurrentStep(n);
  }, [router]);

  const start = useCallback(() => {
    setCurrentStep(0);
    setIsActive(true);
  }, []);

  const next = useCallback(() => {
    setCurrentStep(prev => {
      const n = prev + 1;
      if (n >= TUTORIAL_STEPS.length) { setIsActive(false); return prev; }
      const s = TUTORIAL_STEPS[n];
      if (s?.route) router.push(s.route);
      return n;
    });
  }, [router]);

  const prev = useCallback(() => {
    setCurrentStep(prev => {
      const n = prev - 1;
      if (n < 0) return prev;
      const s = TUTORIAL_STEPS[n];
      if (s?.route) router.push(s.route);
      return n;
    });
  }, [router]);

  const goTo = useCallback((n: number) => {
    const s = TUTORIAL_STEPS[n];
    if (s?.route) router.push(s.route);
    setCurrentStep(n);
  }, [router]);

  const end = useCallback(() => setIsActive(false), []);

  return (
    <Ctx.Provider value={{
      isActive, currentStep, total: TUTORIAL_STEPS.length,
      step: TUTORIAL_STEPS[currentStep],
      start, next, prev, goTo, end,
    }}>
      {children}
    </Ctx.Provider>
  );
}

export function useTutorial() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useTutorial must be inside TutorialProvider");
  return ctx;
}
