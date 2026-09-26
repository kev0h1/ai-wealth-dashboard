import type { CompanionItem } from "@/lib/api";

// G168 — variant A ("Chip and chevron") folded in 2026-09-26. The card
// itself now lives in components/MonthClosedCard.tsx (real production
// component, real props); this preview only needs a fixture item shaped
// exactly like the real one backend/app/services/companion.py ~4808-4836
// builds (id `needle:<closed_end>`, type "needle", headline "Your month
// closed on {weekday}.", empty body, one action routing to
// /month/story?which=last). The needle item is "invitation only, no
// figures" per companion.py's own comment, so there is no real Kevin figure
// to reuse here, unlike other previews that fork a real payload. The
// weekday below is illustrative only.
export const NEEDLE_ITEM: CompanionItem = {
  id: "needle:2026-08-27",
  type: "needle",
  headline: "Your month closed on Thursday.",
  body: "",
  action: { label: "Here's how it went ›", route: "/month/story?which=last" },
  estimated: false,
};
