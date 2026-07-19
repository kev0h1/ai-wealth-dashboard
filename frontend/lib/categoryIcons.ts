import {
  ShoppingCart, Utensils, Bus, Film, ShoppingBag, Receipt, Repeat,
  HeartPulse, Flower2, Plane, Laptop, PiggyBank, CreditCard,
  ArrowLeftRight, Banknote, Coins, HandHeart, Tag,
  Coffee, Gift, Home, Car, Fuel, Smartphone, Wifi, Shield, GraduationCap,
  BookOpen, Music, Gamepad2, Shirt, Dumbbell, PawPrint, Baby, Briefcase,
  Landmark, TrendingUp, Wrench, Scissors, Camera, Bike, TrainFront,
  Wallet, Palette, Sparkles, Wine, Umbrella,
  type LucideIcon,
} from "lucide-react";

// Every icon a category can use. Keys are stable names persisted in the
// per-user icon overrides, so never rename one — add instead.
export const ICON_LIBRARY: Record<string, LucideIcon> = {
  Tag, ShoppingCart, Utensils, Coffee, Wine, ShoppingBag, Gift, Shirt,
  Home, Receipt, Wifi, Smartphone, Shield, Wrench,
  Bus, TrainFront, Car, Fuel, Bike, Plane, Umbrella,
  Film, Music, Gamepad2, Camera, Palette, Sparkles, BookOpen, GraduationCap,
  HeartPulse, Dumbbell, Flower2, Scissors, PawPrint, Baby,
  Briefcase, Laptop, Repeat, PiggyBank, CreditCard, Banknote, Coins,
  Wallet, Landmark, TrendingUp, ArrowLeftRight, HandHeart,
};

// Default icon (by library key) per built-in category.
export const CATEGORY_ICONS: Record<string, string> = {
  Groceries:        "ShoppingCart",
  "Eating Out":     "Utensils",
  Transport:        "Bus",
  Entertainment:    "Film",
  Shopping:         "ShoppingBag",
  Bills:            "Receipt",
  Subscriptions:    "Repeat",
  Health:           "HeartPulse",
  Beauty:           "Flower2",
  Travel:           "Plane",
  Software:         "Laptop",
  Savings:          "PiggyBank",
  Debt:             "CreditCard",
  Transfer:         "ArrowLeftRight",
  "Transfer (in)":  "ArrowLeftRight",
  "Transfer (out)": "ArrowLeftRight",
  Income:           "Banknote",
  Cash:             "Coins",
  Charity:          "HandHeart",
  Other:            "Tag",
};

// Guess an icon from a custom category's name ("Pet food" → paw print).
// First match wins, so more specific words come before generic ones.
const KEYWORD_ICONS: [RegExp, string][] = [
  [/coffee|cafe|caffe/i,                 "Coffee"],
  [/pub|beer|wine|drink|alcohol|bar\b/i, "Wine"],
  [/grocer|food shop|supermarket/i,      "ShoppingCart"],
  [/restaurant|takeaway|take-away|lunch|dinner|food/i, "Utensils"],
  [/gift|present|birthday|christmas/i,   "Gift"],
  [/cloth|fashion|shoe|wardrobe/i,       "Shirt"],
  [/rent|mortgage|home|house|garden|diy/i, "Home"],
  [/phone|mobile/i,                      "Smartphone"],
  [/internet|wifi|broadband/i,           "Wifi"],
  [/insurance|protect/i,                 "Shield"],
  [/repair|maintenance|tool/i,           "Wrench"],
  [/fuel|petrol|diesel/i,                "Fuel"],
  [/car|motor|garage/i,                  "Car"],
  [/train|rail|commute/i,                "TrainFront"],
  [/bike|cycle/i,                        "Bike"],
  [/holiday|vacation|flight|trip/i,      "Plane"],
  [/film|movie|cinema|tv|stream/i,       "Film"],
  [/music|concert|spotify|gig/i,         "Music"],
  [/game|gaming|xbox|playstation|steam/i, "Gamepad2"],
  [/photo|camera/i,                      "Camera"],
  [/art|craft|hobby/i,                   "Palette"],
  [/book|read/i,                         "BookOpen"],
  [/school|education|course|tuition|uni/i, "GraduationCap"],
  [/gym|fitness|sport|run|yoga/i,        "Dumbbell"],
  [/doctor|dental|pharmacy|medic|therapy/i, "HeartPulse"],
  [/beauty|hair|salon|barber|nail/i,     "Scissors"],
  [/pet|dog|cat|vet/i,                   "PawPrint"],
  [/kid|child|baby|nursery/i,            "Baby"],
  [/work|business|office/i,              "Briefcase"],
  [/tech|software|computer|app/i,        "Laptop"],
  [/subscri|member/i,                    "Repeat"],
  [/sav|emergency fund/i,                "PiggyBank"],
  [/debt|loan|credit/i,                  "CreditCard"],
  [/salary|wage|income|payslip/i,        "Banknote"],
  [/cash|atm/i,                          "Coins"],
  [/tax|hmrc|government/i,               "Landmark"],
  [/invest|stock|share|pension/i,        "TrendingUp"],
  [/charity|donat/i,                     "HandHeart"],
  [/wellness|spa|selfcare|self-care/i,   "Sparkles"],
  [/weather|rainy/i,                     "Umbrella"],
];

export function suggestIcon(name: string): string {
  for (const [re, key] of KEYWORD_ICONS) {
    if (re.test(name)) return key;
  }
  return "Tag";
}

// Resolution order: user override → built-in default → name inference → Tag.
export function getCategoryIcon(
  category?: string,
  overrides?: Record<string, string>,
): LucideIcon {
  if (!category) return Tag;
  const key = overrides?.[category] ?? CATEGORY_ICONS[category] ?? suggestIcon(category);
  return ICON_LIBRARY[key] ?? Tag;
}
