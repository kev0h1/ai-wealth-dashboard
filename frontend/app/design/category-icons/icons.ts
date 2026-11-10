import { CATEGORIES } from "@/lib/categories";

// Same names as the authoritative category taxonomy. Extras are display
// aliases or custom examples, not additional built-in categories.
export const CATEGORY_ICON_KEYS: Record<string, string> = {
  Groceries: "shopping-cart",
  "Eating Out": "fork-knife",
  Transport: "bus",
  Entertainment: "film-slate",
  Shopping: "shopping-bag",
  Bills: "receipt",
  Mortgage: "house-line",
  Rent: "key",
  "Car finance": "car",
  Subscriptions: "repeat",
  Health: "heartbeat",
  Beauty: "flower",
  Travel: "airplane-tilt",
  Software: "laptop",
  Savings: "piggy-bank",
  Investment: "trend-up",
  Debt: "credit-card",
  Transfer: "arrows-left-right",
  "Transfer (in)": "arrows-left-right",
  "Transfer (out)": "arrows-left-right",
  Income: "money",
  Cash: "coins",
  Charity: "hand-heart",
  Other: "tag",
  Energy: "lightning",
  Mobile: "device-mobile",
  Business: "briefcase",
};

const KINDS: Record<string, string> = {
  Groceries: "commitment", Transport: "commitment", Bills: "commitment",
  Mortgage: "commitment", Rent: "commitment", "Car finance": "commitment",
  Software: "commitment", Savings: "movement", Investment: "movement",
  Debt: "movement", Transfer: "movement", Income: "income",
};

export const BUILTIN_ICON_ROWS = CATEGORIES.map(name => ({
  name, kind: KINDS[name] ?? "discretionary", iconKey: CATEGORY_ICON_KEYS[name],
}));

// A deterministic preview of the first selection pass. Unknown words use
// the neutral tag. The production fold-in adds an allowlisted model fallback
// on creation/rename, never on render and never a network icon fetch.
const KEYWORDS: readonly [RegExp, string][] = [
  [/\b(golf)\b/i, "golf"],
  [/\b(padel|tennis|badminton|squash|racquet|racket)\b/i, "racquet"],
  [/\b(football|soccer)\b|five[- ]a[- ]side/i, "soccer-ball"],
  [/\b(pet|pets|dog|dogs|cat|cats|vet|veterinary)\b/i, "paw-print"],
  [/\b(childcare|nursery|baby|babies|children|kids)\b/i, "baby"],
  [/\b(coffee|cafe|café|caffe)\b/i, "coffee"],
  [/\b(pub|beer|wine|alcohol|bar|drinks)\b/i, "wine"],
  [/\bgrocer\w*\b|food shop|supermarket/i, "shopping-cart"],
  [/\b(restaurant|takeaway|take-away|lunch|dinner|food|meals)\b/i, "fork-knife"],
  [/\b(gift|gifts|present|presents|birthday|christmas)\b/i, "gift"],
  [/\b(clothes|clothing|fashion|shoes|wardrobe)\b/i, "t-shirt"],
  [/\b(rent|rental)\b/i, "key"],
  [/\b(mortgage|home|house|garden|diy)\b/i, "house-line"],
  [/\b(phone|mobile|sim)\b/i, "device-mobile"],
  [/\b(internet|wifi|wi-fi|broadband)\b/i, "wifi-high"],
  [/\b(energy|electricity|gas|heating|power)\b/i, "lightning"],
  [/\bwater\b/i, "drop"],
  [/\binsuran\w*\b|\bprotect\w*\b/i, "shield-check"],
  [/\b(repair|repairs|maintenance|tools)\b/i, "wrench"],
  [/\b(fuel|petrol|diesel)\b/i, "gas-pump"],
  [/\b(car|motor|garage|vehicle)\b/i, "car"],
  [/\b(train|rail|railway|commute)\b/i, "train"],
  [/\b(bike|bicycle|cycle|cycling)\b/i, "bicycle"],
  [/\b(bus|transport)\b/i, "bus"],
  [/\b(holiday|vacation|flight|trip|travel)\b/i, "airplane-tilt"],
  [/\b(film|films|movie|cinema|tv|streaming|entertainment)\b/i, "film-slate"],
  [/\b(music|concert|spotify|gig|festival)\b/i, "music-notes"],
  [/\b(game|games|gaming|xbox|playstation|steam)\b/i, "game-controller"],
  [/\b(photo|photos|photography|camera)\b/i, "camera"],
  [/\b(art|craft|crafts|hobby|hobbies)\b/i, "palette"],
  [/\b(book|books|reading|library)\b/i, "book-open"],
  [/\b(school|education|course|tuition|university)\b/i, "graduation-cap"],
  [/\b(gym|fitness|sport|sports|running|yoga|exercise)\b/i, "barbell"],
  [/\b(doctor|dental|pharmacy|medical|medicine|health|therapy)\b/i, "heartbeat"],
  [/\b(hair|salon|barber|nails|haircut)\b/i, "scissors"],
  [/\b(spa|wellness|wellbeing)\b|self[- ]care/i, "flower-lotus"],
  [/\b(beauty|cosmetics)\b/i, "flower"],
  [/\b(work|business|office)\b/i, "briefcase"],
  [/\b(tech|technology|software|computer|app|apps)\b/i, "laptop"],
  [/\b(subscription|subscriptions|membership)\b/i, "repeat"],
  [/\b(saving|savings|save)\b|emergency fund/i, "piggy-bank"],
  [/\b(investment|investments|stocks|shares|pension|isa)\b/i, "trend-up"],
  [/\b(debt|loan|credit|repayment)\b/i, "credit-card"],
  [/\b(transfer|transfers)\b/i, "arrows-left-right"],
  [/\b(salary|wage|wages|income|payslip)\b/i, "money"],
  [/\b(cash|atm)\b/i, "coins"],
  [/\b(tax|hmrc|government|bank)\b/i, "bank"],
  [/\b(charity|donation|donations|donate)\b/i, "hand-heart"],
  [/\b(bill|bills|invoice|invoices)\b/i, "receipt"],
  [/\b(shopping|retail)\b/i, "shopping-bag"],
  [/\b(weather|rainy)\b/i, "umbrella"],
];

export function suggestIcon(name: string, kind?: string): string {
  if (kind === "movement" && /\b(savings?|fund|pot|pots|jar|buffer)\b/i.test(name)) return "piggy-bank";
  for (const [pattern, iconKey] of KEYWORDS) if (pattern.test(name)) return iconKey;
  return kind === "income" ? "money" : "tag";
}

export function getIconLabel(key: string): string {
  return ICON_CATALOG.find(icon => icon.key === key)?.label ?? "Tag";
}

// G450 preview-only catalogue. Bundled originals: SOURCES.md.
export const ICON_CATALOG: readonly { key: string; label: string; terms: string; group: string }[] = [
  {
    "key": "tag",
    "label": "Tag",
    "terms": "other general neutral fallback",
    "group": "Everyday"
  },
  {
    "key": "shopping-cart",
    "label": "Shopping trolley",
    "terms": "groceries supermarket food shop",
    "group": "Everyday"
  },
  {
    "key": "fork-knife",
    "label": "Cutlery",
    "terms": "eating out restaurant takeaway meals dinner lunch food",
    "group": "Everyday"
  },
  {
    "key": "coffee",
    "label": "Coffee",
    "terms": "cafe caf\u00e9 drinks",
    "group": "Everyday"
  },
  {
    "key": "wine",
    "label": "Wine",
    "terms": "pub beer alcohol bar drinks",
    "group": "Everyday"
  },
  {
    "key": "shopping-bag",
    "label": "Shopping bag",
    "terms": "shopping retail",
    "group": "Everyday"
  },
  {
    "key": "gift",
    "label": "Gift",
    "terms": "presents birthdays christmas",
    "group": "Everyday"
  },
  {
    "key": "t-shirt",
    "label": "Clothes",
    "terms": "clothing fashion shoes wardrobe",
    "group": "Everyday"
  },
  {
    "key": "house-line",
    "label": "House",
    "terms": "home mortgage garden diy",
    "group": "Home and bills"
  },
  {
    "key": "key",
    "label": "Key",
    "terms": "rent rented property",
    "group": "Home and bills"
  },
  {
    "key": "receipt",
    "label": "Receipt",
    "terms": "bills invoice utilities",
    "group": "Home and bills"
  },
  {
    "key": "lightning",
    "label": "Energy",
    "terms": "electricity gas power heating utilities",
    "group": "Home and bills"
  },
  {
    "key": "drop",
    "label": "Water",
    "terms": "water utility",
    "group": "Home and bills"
  },
  {
    "key": "device-mobile",
    "label": "Mobile phone",
    "terms": "phone mobile sim",
    "group": "Home and bills"
  },
  {
    "key": "wifi-high",
    "label": "Wi-Fi",
    "terms": "internet broadband wifi",
    "group": "Home and bills"
  },
  {
    "key": "shield-check",
    "label": "Insurance",
    "terms": "protect insurance",
    "group": "Home and bills"
  },
  {
    "key": "wrench",
    "label": "Repairs",
    "terms": "repair tools maintenance",
    "group": "Home and bills"
  },
  {
    "key": "bus",
    "label": "Bus",
    "terms": "transport bus commute",
    "group": "Travel"
  },
  {
    "key": "train",
    "label": "Train",
    "terms": "rail railway train commute",
    "group": "Travel"
  },
  {
    "key": "car",
    "label": "Car",
    "terms": "car finance vehicle motor garage",
    "group": "Travel"
  },
  {
    "key": "gas-pump",
    "label": "Fuel",
    "terms": "petrol diesel fuel",
    "group": "Travel"
  },
  {
    "key": "bicycle",
    "label": "Bicycle",
    "terms": "cycling bike cycle",
    "group": "Travel"
  },
  {
    "key": "airplane-tilt",
    "label": "Aeroplane",
    "terms": "travel holiday flight trip vacation",
    "group": "Travel"
  },
  {
    "key": "umbrella",
    "label": "Umbrella",
    "terms": "rain weather",
    "group": "Travel"
  },
  {
    "key": "film-slate",
    "label": "Film",
    "terms": "entertainment cinema movie tv streaming",
    "group": "Leisure"
  },
  {
    "key": "music-notes",
    "label": "Music",
    "terms": "music concert gig festival",
    "group": "Leisure"
  },
  {
    "key": "game-controller",
    "label": "Games",
    "terms": "gaming xbox playstation steam",
    "group": "Leisure"
  },
  {
    "key": "camera",
    "label": "Camera",
    "terms": "photography photo",
    "group": "Leisure"
  },
  {
    "key": "palette",
    "label": "Art",
    "terms": "art crafts hobby hobbies",
    "group": "Leisure"
  },
  {
    "key": "book-open",
    "label": "Book",
    "terms": "books reading library",
    "group": "Leisure"
  },
  {
    "key": "graduation-cap",
    "label": "Education",
    "terms": "school tuition learning courses university",
    "group": "Leisure"
  },
  {
    "key": "golf",
    "label": "Golf",
    "terms": "golf course clubs",
    "group": "Leisure"
  },
  {
    "key": "racquet",
    "label": "Racquet",
    "terms": "padel tennis badminton squash racket",
    "group": "Leisure"
  },
  {
    "key": "soccer-ball",
    "label": "Football",
    "terms": "football five a side sport soccer",
    "group": "Leisure"
  },
  {
    "key": "barbell",
    "label": "Fitness",
    "terms": "gym yoga fitness exercise running sport",
    "group": "Leisure"
  },
  {
    "key": "heartbeat",
    "label": "Health",
    "terms": "medical dental doctor pharmacy therapy",
    "group": "Everyday"
  },
  {
    "key": "flower",
    "label": "Beauty",
    "terms": "beauty cosmetics wellness",
    "group": "Everyday"
  },
  {
    "key": "flower-lotus",
    "label": "Wellbeing",
    "terms": "spa wellness self care wellbeing",
    "group": "Everyday"
  },
  {
    "key": "scissors",
    "label": "Haircut",
    "terms": "hair salon barber nails",
    "group": "Everyday"
  },
  {
    "key": "paw-print",
    "label": "Pets",
    "terms": "pet dog cat veterinary vet",
    "group": "Everyday"
  },
  {
    "key": "baby",
    "label": "Childcare",
    "terms": "baby kids children nursery childcare",
    "group": "Home and bills"
  },
  {
    "key": "briefcase",
    "label": "Business",
    "terms": "work office business professional",
    "group": "Money and work"
  },
  {
    "key": "laptop",
    "label": "Laptop",
    "terms": "software technology computer apps",
    "group": "Money and work"
  },
  {
    "key": "repeat",
    "label": "Subscriptions",
    "terms": "subscriptions membership recurring",
    "group": "Everyday"
  },
  {
    "key": "piggy-bank",
    "label": "Savings",
    "terms": "saving emergency fund pot",
    "group": "Money and work"
  },
  {
    "key": "trend-up",
    "label": "Investment",
    "terms": "investments stocks shares pension isa",
    "group": "Money and work"
  },
  {
    "key": "credit-card",
    "label": "Card",
    "terms": "debt loan credit repayment",
    "group": "Money and work"
  },
  {
    "key": "arrows-left-right",
    "label": "Transfer",
    "terms": "transfers moved money own accounts",
    "group": "Money and work"
  },
  {
    "key": "money",
    "label": "Income",
    "terms": "salary wages pay earnings banknote",
    "group": "Money and work"
  },
  {
    "key": "coins",
    "label": "Cash",
    "terms": "cash atm coins",
    "group": "Money and work"
  },
  {
    "key": "wallet",
    "label": "Wallet",
    "terms": "allowance spending pocket money",
    "group": "Money and work"
  },
  {
    "key": "bank",
    "label": "Bank",
    "terms": "bank tax hmrc government",
    "group": "Money and work"
  },
  {
    "key": "hand-heart",
    "label": "Charity",
    "terms": "charity donations giving",
    "group": "Money and work"
  }
];
