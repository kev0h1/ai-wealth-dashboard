import {
  Landmark, Plus, Upload, TrendingUp, ArrowLeftRight, ListChecks,
  Tag, Info, CalendarDays, Receipt, Wallet, Target,
} from "lucide-react";
import PhosphorNavIcon from "@/components/navigation/PhosphorNavIcon";
import PennyAppearanceIcon from "@/components/PennyAppearanceIcon";
import { getCategoryIcon } from "@/lib/categoryIcons";
import type { PennyAppearance } from "@/lib/pennyAppearance";

const NAV_TABS = { Home: "home", Spend: "spend", Upcoming: "upcoming", Planning: "planning" } as const;
const SECTION_ICONS = {
  Accounts: Landmark,
  Add: Plus,
  Statement: Upload,
  Investment: TrendingUp,
  Offline: Plus,
  Transfers: ArrowLeftRight,
  Categories: ListChecks,
  Category: Tag,
  Categorisation: Info,
  Periods: CalendarDays,
  Payments: Receipt,
  SetAsides: Wallet,
  Goals: Target,
} as const;

export type TutorialIconName = "Penny" | keyof typeof NAV_TABS | keyof typeof SECTION_ICONS;

/** Tutorial symbols use the same navigation and Penny assets as their destinations. */
export default function TutorialIcon({ iconName, appearance, resolved, className = "" }: {
  iconName: TutorialIconName;
  appearance: PennyAppearance;
  resolved: boolean;
  className?: string;
}) {
  const nav = iconName in NAV_TABS;
  const colour = nav && resolved && appearance === "original"
    ? "text-indigo-600 dark:text-indigo-300" : "text-slate-900 dark:text-slate-100";
  let glyph;
  if (iconName === "Penny") {
    glyph = resolved ? <PennyAppearanceIcon appearance={appearance} size={24} /> : null;
  } else if (nav) {
    glyph = <PhosphorNavIcon tab={NAV_TABS[iconName as keyof typeof NAV_TABS]} selected appearance={resolved ? appearance : "pending"} />;
  } else if (iconName === "Category" || iconName === "Investment" || iconName === "Transfers") {
    const CategoryIcon = getCategoryIcon(iconName === "Category" ? "Other" : iconName === "Investment" ? "Investment" : "Transfer");
    glyph = <CategoryIcon size={24} aria-hidden="true" />;
  } else {
    const Icon = SECTION_ICONS[iconName as keyof typeof SECTION_ICONS];
    glyph = <Icon size={24} strokeWidth={1.8} aria-hidden="true" />;
  }
  return <span
    aria-hidden="true"
    data-tutorial-icon={iconName}
    data-penny-appearance={iconName === "Penny" ? resolved ? appearance : "pending" : undefined}
    className={`inline-flex size-6 shrink-0 items-center justify-center ${colour} ${className}`}
  >{glyph}</span>;
}
