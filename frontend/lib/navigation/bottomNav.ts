/** The four destinations share a rail with the adviser door in slot 2. */
export const BOTTOM_NAV_TABS = [
  { id: "home", href: "/", label: "Home", slot: 0 },
  // A nav tap explicitly returns to the pay-period view, not Patterns.
  { id: "spend", href: "/spend?view=period", label: "Spend", slot: 1 },
  { id: "upcoming", href: "/upcoming", label: "Upcoming", slot: 3 },
  { id: "planning", href: "/planning", label: "Planning", slot: 4 },
] as const;

export type BottomNavTab = (typeof BOTTOM_NAV_TABS)[number]["id"];
