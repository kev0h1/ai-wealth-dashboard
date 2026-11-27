import type { PhosphorIcon } from "@/lib/phosphorIcons";
import { getCategoryColour } from "@/lib/categories";
import { getCategoryIcon } from "@/lib/categoryIcons";

/** The dated list and account activity share category defaults and overrides. */
export function upcomingCategoryAppearance(
  category: string | null | undefined,
  type: "bill" | "income",
  colours: Record<string, string>,
  icons: Record<string, string>,
) {
  const name = category || (type === "income" ? "Income" : "Other");
  return { Icon: getCategoryIcon(name, icons), colour: getCategoryColour(name, colours) };
}

/** Category identity only. Risk and settling indicators belong to their row. */
export default function UpcomingCategoryIcon({ Icon, colour }: { Icon: PhosphorIcon; colour: string }) {
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" style={{ backgroundColor: `${colour}26` }} aria-hidden="true">
      <Icon size={15} style={{ color: colour }} />
    </span>
  );
}
