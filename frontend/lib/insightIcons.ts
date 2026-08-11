import {
  Car, MonitorPlay, Zap, ShoppingBasket, Smartphone, Home, Dumbbell,
  Wifi, UtensilsCrossed, Shield, Droplets, PiggyBank, HeartPulse, Landmark, Tv,
  type LucideIcon,
} from "lucide-react";

// Ways-to-save insight category → lucide icon. The backend still sends an
// emoji `icon` string for legacy clients; the web app renders these instead
// so insight chips match the rest of the app's icon language.
const INSIGHT_CATEGORY_ICONS: Record<string, LucideIcon> = {
  car_finance:   Car,
  car_insurance: Shield,
  subscriptions: MonitorPlay,
  energy:        Zap,
  groceries:     ShoppingBasket,
  mobile:        Smartphone,
  mortgage:      Home,
  gym:           Dumbbell,
  broadband:     Wifi,
  eating_out:    UtensilsCrossed,
  insurance:     Shield,
  water:         Droplets,
  // Bill-labelling picker keys (backend LABEL_OPTIONS) not covered above
  home_insurance: Shield,
  life_insurance: HeartPulse,
  council_tax:    Landmark,
  tv_licence:     Tv,
  pension:        Landmark,
};

export function insightCategoryIcon(category: string): LucideIcon {
  return INSIGHT_CATEGORY_ICONS[category] ?? PiggyBank;
}
