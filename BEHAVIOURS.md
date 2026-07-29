# Behaviours

> Budgets say: here's what you should be. A mirror says: here's who you are — do you like it?

---

## Register

behaviours

## Platform

web + mobile (WebView parity)

---

## The Pivot

Budget-led products assume the user wants to change. Most don't — they want relief from a feeling: *am I okay, am I a mess, do I have control?* Asking someone to stick to a budget before understanding who they are is a misdiagnosis; it nags because it doesn't know its patient.

The behaviour-led model inverts this: understand identity first, ask consent before coaching, then anchor change to the user's own rhythm and verify it automatically from transaction data. The product becomes a mirror before it becomes a coach. Nobody opted in to being watched; they opted in to being understood.

---

## 1. The Five Layers

These are the product engine — each layer depends on the one above it.

### Layer 1 — Identity

Deterministic signatures computed from transaction history after each sync. No guesswork; every trait has a cited evidence set.

**Computed signatures:**

| Signature | What it detects |
|---|---|
| **Payday-cliff concentration** | Fraction of month's discretionary spend that falls in the 3 days after payday |
| **Credit-switch timing** | When in the pay cycle the user migrates from debit to credit spending |
| **Saving streak / frequency** | Regularity and consistency of transfers to savings accounts or pots |
| **Discretionary signature category** | The one category where spend is systematically higher than statistical peers |
| **Multi-account orchestration** | Whether the user routes money deliberately between accounts (bill account, spending account, savings pot) |
| **Cash / BNPL / gambling presence** | Binary flags for each; presence alone noted, not moralised |
| **Payment reliability** | On-time payment rate across direct debits, standing orders, and card minimum payments |

These are distilled into **named traits** ("You're a payday spender", "You run a deliberate float system", "You save in bursts, not dribs"). AI narrates the portrait from computed facts — it never invents a figure. If a signature cannot be computed with confidence (thin history, sparse data), the trait is suppressed, not guessed.

Identity is recomputed monthly. "You've changed" is a headline moment, not a footnote.

### Layer 2 — The Mirror + Consent

The portrait is shown, one trait at a time, with real evidence underneath each one. For each trait the user makes a single choice:

- **Keep this** — honoured and celebrated, never nagged again.
- **Change this** — unlocks coaching for that trait only.

The app never presumes direction. A user who marks every trait "keep" gets a product that celebrates who they are. Only traits explicitly marked "change" unlock Layers 3 and 4. The consent state is persistent and revisable.

### Layer 3 — Paradoxes

For consented traits only. A paradox is a contradiction between identity and structure — something the user's own data reveals without needing the AI to moralize.

*Example: "You saved £257 last month while your credit cards grew by £430."*

Rules:
- One paradox per user at a time. A list of contradictions is an accusation; a single one is an insight.
- Every paradox proposes a structural redirect, not a behaviour ban. The redirect points the existing habit at a better destination — it never asks the user to stop being who they are.
- *Example resolution: "You're already a daily saver — that instinct is real. Point the daily transfer at the Amex instead of the pot and the paradox closes itself."*

### Layer 4 — Rhythms → Checkpoints

Every user has a **personal money calendar** derived from their transaction pattern: when the payday cliff hits, when the credit switch happens, when bills cluster, when the buffer traditionally runs thin. This is not a generic budget calendar; it is theirs.

**Checkpoints** are concrete one-action steps anchored to those personal moments — placed one day before the cliff, at the start of the switch week, at the streak milestone.

Checkpoints are **verified automatically from transaction data**. The app sees the action happen in the feed; the user is not asked to report it. No checkbox, no self-report, no manual logging of any kind. If the app cannot verify a checkpoint from data, the checkpoint may not ship.

Goal lists are explicitly rejected. A list of intentions is a to-do list; a verified checkpoint is evidence.

### Layer 5 — Proactive Penny

The AI initiates, timed to the user's own rhythm. Penny is not a reactive chatbot waiting to be asked — she observes the calendar and acts first.

**Trigger moments:**
- Day before the payday cliff
- Start of the credit-switch window
- Streak milestone hit (or broken)
- Monthly paradox review (for users with consented-change traits)
- Unexpected pattern deviation (spend spike in a signature category)

Every proactive message deep-links to a surface where action is possible — not to a generic chat. Reactive chat remains available but is not the centre of gravity.

Penny's gradient (indigo→violet) marks every proactive surface. If the gradient is present, advice is available; if it is absent, the surface is informational.

---

## 2. Named Rules

**The Consent Rule.** No coaching, paradox, or nudge may appear on a trait the user has not marked "change". Keep-traits receive celebration only — verified streaks, identity moments, milestone cards. The product never presumes the user wants to be different.

**The Redirect Rule.** Change the destination or structure of a habit, never the habit itself. A payday spender is not asked to stop spending; they are asked to redirect the first spend. A daily saver who saves into the wrong pot is not told to stop saving; the pot is pointed elsewhere. The identity is always the asset.

**The Verified Checkpoint Rule.** A checkpoint the product cannot verify from transaction data may not ship. Manual logging, self-report, and checkbox completion are forbidden as evidence of change. The standard is: the app saw the money move.

**The One Paradox Rule.** One paradox surfaced per user at a time, never a stack. A second paradox is not shown until the first is resolved or dismissed. A paradox list is a verdict on the user's character; a single paradox is an observation about their structure.

**The Facts / Voice Split.** Deterministic code computes every figure — total saved, credit growth, streak length, reliability rate. The AI narrates what those figures mean in plain English. An AI-generated number with no deterministic source is a trust breach and must never reach the user.

**The Mirror Is Not A Score.** Identity is described, never graded. No health score, no star rating, no "financial fitness" percentage, no comparison to other users. The mirror tells the user who they are; it does not tell them how well they are doing relative to a rubric.

---

## 3. Emotional Jobs Mapping

| Layer | Emotional job | How it's served |
|---|---|---|
| Identity / Mirror | *Am I okay? Am I a mess?* | Honest portrait with evidence; the answer is descriptive, not evaluative |
| Keep-traits | *Permission to spend / live this way* | Marked keep-traits are celebrated and never flagged — the signature category becomes legitimate, not a shame item |
| Paradox | *Guilt and contradiction* | Framed as a structural mismatch, not a moral failure; redirect offered immediately |
| Checkpoints + streaks | *Progress and identity* | Verified actions become identity evidence ("you did it three months running") — not points on a leaderboard |
| Rhythm calendar | *Control during chaos* | The month is made predictable; the cliff and the switch window are anticipated, not discovered in crisis |

---

## 4. Relationship to Existing Surfaces

**Budgets tab → Behaviours tab.** The migration is gradual — budgets are not removed overnight. In the short term, budgets remain available for users who want them. Over time, the Behaviours layer becomes the primary tab and budget limits become one optional structural tool within a checkpoint, not the primary product surface.

**Challenges / XP system.** The existing challenges engine is the ancestor of the checkpoint engine. Challenges that can be verified from transaction data are upgraded to checkpoints. The XP / streak mechanic is retained as the identity-evidence layer (streaks become identity proof, not gamification for its own sake).

**Insights engine.** Transaction-pattern insights feed the paradox-detection pipeline. An insight that surfaces a contradiction between two data points is a paradox candidate — it moves from the Insights tab into the consented-change flow rather than appearing as a generic card.

**Notification preferences.** The existing four notification types (spend alerts, bill reminders, savings milestones, weekly digest) gain a fifth: **Rhythm** — Penny-initiated, consent-gated, timed to the personal calendar. Users who have no consented-change traits receive rhythm notifications only for milestone celebrations. The notification preference surface exposes rhythm as a distinct toggle.

**Design language.** The Calm Cockpit (DESIGN.md) applies without exception. Calm under bad news; red is genuine financial risk only; the indigo→violet gradient is Penny's signature and marks every proactive advice surface. Paradox cards are not red — they are structural, not dangerous. Identity cards do not use warning amber — a signature category is a fact, not a caution.

---

## 5. Engineering Doctrine

**Signatures are computed post-sync and cached.** The same pattern as the cashflow cache: compute on the worker after each sync completes, write to a user-scoped store, serve from cache on all page loads. Do not recompute on request.

**Thresholds are generic, never user-specific hardcodes.** A "payday-cliff" threshold (e.g. >40% of monthly discretionary in days 1–3) is a product-level constant, tunable by config, applied identically to all users. Per-user overrides in code are forbidden — see the categorisation pipeline precedent.

**Traits require minimum evidence.** Each signature defines a minimum transaction count and date-range before it will fire. Below the threshold the trait is suppressed and the portrait shows "not enough data yet" for that dimension. Degrading gracefully on thin history is a product requirement, not an engineering edge case.

**LLM usage is bounded.** The AI narrates the identity portrait once per monthly recompute and caches the narrative. Paradox framing generates once when a paradox is first surfaced and caches until resolved. Proactive Penny messages are templated with injected deterministic figures — they do not call the LLM per-user per-notification. LLM calls in this layer are O(monthly recomputes) not O(sessions).

**Consent state is durable.** Mirror consent choices are stored per-user and survive re-authentication, sync failures, and recomputes. A user who marked a trait "keep" six months ago should never be coached on it without explicitly revisiting the mirror.
