# Product

## Register

product

## Platform

web

## Users

UK consumers who connect their real bank accounts (via open banking) and want their money handled without spreadsheet labour. Today that's the founder and a small invited circle, but the product is deliberately built for a paying public audience — subscription tiers exist and every screen must earn the instant trust of a stranger handing over bank access. Users arrive in everyday moments (checking the phone after payday, worrying about an upcoming bill) and on mobile as often as desktop; the same responsive web UI ships inside the Android/iOS WebView app.

## Product Purpose

An AI wealth dashboard that turns live bank data into judgement: spending by pay period, budgets, debt payoff, safety-net savings, upcoming bills, tax efficiency, and savings opportunities — all auto-tracked from transactions with no manual logging. Success on any given screen is instant clarity: within ten seconds the user knows *am I okay, what changed, and what should I do next*, without digging.

## The payday plan (2026-11-02)

The payday plan answers one question: can next period's requirements be met from the account pay lands in? It is about meeting bills, not about saving. From that account it tracks the transfers to the other accounts on file. For each of those accounts it shows the recurring payments and amounts required, plus any goals, one-offs and set-asides on file. It never asks for money to be moved to a savings account where it would just sit.

Three decisions shape it (Kevin, 2026-11-02):

1. Everyday spending is not a requirement. The app already shows where to spend from, so the plan does not pad any account for it.
2. Habitual transfers are the user's own. The plan does not include them and says so in one line, working copy "This doesn't include your habitual transfers".
3. A buffer sits only on accounts that have bills leaving them, because bills vary, and only after each predicted bill is covered first.

What the plan never does:

- Ask for a savings top-up, unless a goal or set-aside names that account.
- Pad for spending.
- Add a flat buffer to every account.
- Run a lifecycle. There is nothing to verify and nothing to celebrate (G172).
- Move money. The plan is a recommendation, and the app never moves money.

The engine rule that implements this lives in G402 and, once built, in MONEY-ENGINE.md.

## Positioning

The money app that tells you what to do next — every screen turns live bank data into a concrete next action, not just charts.

## Brand Personality

Calm, capable, encouraging. Money is stressful; the app is the steady adviser — it states problems plainly (over budget, bill at risk) without alarm theatre, and celebrates real wins (verified savings, debt milestones) without confetti inflation. Penny, the AI adviser, speaks like a knowledgeable friend, never a salesperson. The feel steers toward Monzo/Emma — UK money-app polish with friendly cards, clear categories, and confident colour — never toward dry legacy banking.

## Anti-references

- Legacy bank portals: dense grey tables, jargon, 2010s enterprise chrome — the NatWest-online-banking feeling.
- Crypto-bro dashboards: neon-on-black, hype gradients, casino energy.
- Generic AI templates: the bland default-shadcn look that could be any SaaS. This product has its own identity (indigo→violet brand, slate surfaces, category colour language) and should keep sharpening it.

## Design Principles

1. **Answer first, evidence second.** Lead every screen with the verdict (on track / 4 over / £862 to go); charts and lists exist to back it up, not to be decoded.
2. **Always say what to do next.** A number without a next action is unfinished — pair states with a concrete step (reconnect, re-baseline, switch, pin, ask Penny).
3. **Calm under bad news.** Red is for genuine risk, used sparingly; problems get plain words and a way forward, never blame or alarm styling.
4. **Earn trust like a bank, feel like a friend.** Real figures, honest estimates labelled as estimates ("· estimated"), verified savings distinguished from projections — inside a warm, rounded, colourful UI.
5. **Zero manual labour.** Anything the app can derive from transactions, it must; never ask the user to log, tag, or track what the data already says.

## Accessibility & Inclusion

WCAG AA: text contrast ≥ 4.5:1 in both light and dark themes, visible focus states, `prefers-reduced-motion` respected on all animation, touch targets sized for thumbs (the primary device is a phone). Dark mode is a first-class theme, not an afterthought. Numbers must remain legible at a glance for users checking balances in a hurry.
