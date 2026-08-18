# Engine

> Emma gives you a ledger and tidy-up tools and asks you to keep it neat. Sorted classifies your money for you, shows its working, and asks only when it is genuinely stuck.

---

## Register

engine

## Platform

backend (Python) + every surface that renders a category

---

## The Position

Every UK money app makes the same contract: *here is your ledger and here are the category tools — you keep it tidy.* That contract makes the user a data-entry clerk for their own bank feed. Sorted's contract is the inverse.

**The Engine Owns It Rule.** Categorisation is the engine's job, for everyone, always. Categories are infrastructure — the engine's internal vocabulary for producing verdicts (Safe to Spend, pace, bills, the payday plan) — not an interface the user maintains. Users see categories everywhere, as labels on views; they never manage them, never tune detection, never keep a taxonomy tidy.

This is only honest if the engine is right, learns when it is wrong, and can prove any verdict. Those three obligations — classify, learn, trace — are the whole doctrine.

---

## The Three Roles

**The Engine** classifies every transaction, consistently, for everyone, and learns from every correction. It is deterministic first and pays for intelligence only where intelligence is needed.

**The Surfaces** show verdicts with evidence. Every verdict is traceable to the exact transactions that produced it, honestly scoped. A surface never invents a number and never asks the user to do the engine's job.

**The User** does exactly two things, and no more:

**The Two Inputs Rule.** The user only ever (1) NAMES things they care about — "this is Padel", "this is my House Fund" — and (2) CORRECTS the engine when its story is wrong — "that's not spending, that's my house fund". They never maintain a ledger, never configure a heuristic, never curate a trust list. Naming and correcting are the only inputs the product accepts, because in an engine-owned model intervention *is* the user's contribution — and an engine that cannot learn from it is not calm, it is gaslighting.

---

## The Input Contract

The Two Inputs Rule says what the user does; this says exactly what the engine needs and where the product takes it. The engine needs precisely **six signals** from the user — no more — and it collects every one **in-flow**, on a real transaction or a real card, never on a settings page.

| Signal | What it teaches | Where it is collected |
| --- | --- | --- |
| **Correction** — "this is Padel, not Shopping" | merchant→category mapping, then propagation | the transaction sheet, one tap (`PATCH /transactions/{id}`, `transactions.py:211`) |
| **Naming** — a new word for something in the user's life | spend vocabulary (movement resolutions link a destination instead, per the Destination Rule) | INSIDE the correction picker ("Something else…"), not a settings page |
| **Kind confirm** — spend / commitment / movement | how money counts | one tap at naming, inferred first (kinds in `backend/app/services/categories.py`) |
| **Intent** — one-off vs new normal | baseline adjustment | the intent pair on notable cards |
| **Ask answer** — ≤50 chars on an unresolvable merchant | identity facts | the ask card, tier 4 |
| **Bill confirm / dismiss** | recurring-detection trust | the existing prediction flow in Planning (`dismiss_recurring`, `analytics.py:1045`) |

Then three rules that make those six buildable.

**The Born-in-Context Rule.** Categories are created where they are used, never in settings. The birthplace of "Padel" is the correction picker on a real transaction — type the name, confirm the inferred kind, done. A category the user has to go somewhere to create is overhead; a category that appears mid-correction is vocabulary — spend vocabulary only, since a movement resolution links a destination instead of naming a category (the Destination Rule). The standalone add-category flow in Spend settings (`add_category`, `categories.py:65`) is deprecated by this rule.

**The Retirement Rule.** Categories are never deleted, they retire. A category no transaction carries simply disappears from every view on its own; if the word comes back into use, it returns. "Stop using the word" replaces "manage the list" — no delete button (`delete_category`, `categories.py:108`), no orphaned-tag problem, no maintenance surface.

**The One Stream Rule.** All six signals land as one uniform teaching-event stream the engine consumes — not six bespoke endpoints with six bespoke behaviours. Every tier of the ladder reads the same feedback regardless of how it arrived — a correction, an ask answer, an intent tap. This is what makes the engine buildable by agents: one funnel in, one learning loop behind it.

---

## The Ladder

Four tiers, cost-ordered, escalated only when the tier above gives up. Every answer feeds back DOWN the ladder so it is never paid for twice.

1. **Deterministic** — merchant identity (`merchant_key`), the learned cache, user rules. Free, instant. Absorbs the vast majority. (Today: `MERCHANT_PATTERNS` + Passes 0–3.5 in `backend/app/services/categorisation.py`.)
2. **LLM judgement** — the existing name-check / classify pass on the Haiku tier (`llm_name_check`, `categorise_others_bg` in `categorisation.py`, `anthropic/claude-haiku-4-5`). Cheap, for routine ambiguity. Direction (debit/credit) is part of the signal handed to the model on every line, not just the text: amounts are absolute and `transaction_type` carries direction, so a description alone can't tell the model which way money moved. A debit can never be Income, whatever the text says.
3. **Web search + reasoning** — for merchants that survive tiers 1–2, one Tavily search ("What is Playtomic?" — the key already exists, `TAVILY_API_KEY` at `backend/app/core/config.py:22`) synthesised by a Sonnet-tier call into a judgement.
4. **Ask the user** — last resort. ≤50 characters, in Penny's voice. Precedent: the debt page's `ask_card` ("tell me how you use it and the picture sharpens", `backend/app/services/debt_narration.py:100`).

**The One-Way Ladder Rule.** Escalation is one-way and paid once. A merchant only reaches tier 3 after tiers 1–2 fail; model tiering follows the deciding-vs-formatting split — pay for reasoning exactly where reasoning happens (tier 3), never blanket-upgrade the routine tiers. A tier-3 web answer becomes a cached tier-1 fact, so the fifth Playtomic row costs nothing.

---

## Learning & Scope

**What a category is.** A category is a word for a kind of spending, whose job is to let the engine compare the user with their own usual — in their language. It exists so a verdict can be spoken: "Padel is running above usual" is only possible because the word Padel exists. No comparison to make, no sentence to say → no reason for a category.

The ontology, then — what is a category, and what only looks like one:

- **Groceries, Eating Out, Transport, Bills, Subscriptions, Health, Beauty, Travel, Software, Entertainment, Shopping, Cash, Charity** — the **shared spend vocabulary**: the baseline words every user starts with, and what the global merchant catalog maps to as world-fact defaults.
- **Padel, Golf** (user-created) — the **personal spend vocabulary**: the user's words layered on top. The catalog's default might say leisure; the user's mapping says Padel, and their word wins for them (user-scoped, per the Firewall Rule). Functionally identical to the built-ins — baselines, multiples, verdicts — the only difference is who coined the word.
- **Transfer, Savings, Investment, Debt** — **not categories: movement** (see the Destination Rule below). They survive only as internal kinds so the arithmetic knows "not spend"; nothing is ever filed there again.
- **Income** — **not a category: a direction.** An internal kind.
- **Other** — **not a category: the engine's unresolved state.** A queue position awaiting the ladder or an ask. Never a baseline, never a multiple, never a peer tile.

A category earns comparison-unit status through history and materiality: the engine needs it *counted* from day one, but it becomes a unit of verdict only when it can hold a baseline and matters in pounds. Words the user stops using retire on their own (the Retirement Rule).

Two kinds of fact, and they must never be confused:

- Facts about **the world** — "Playtomic is a padel court booking platform" — go to a **global catalog**. They benefit every user and compound into a proprietary UK merchant catalog. That catalog is the moat.
- Facts about **the user** — "Kevin files padel under his custom Padel category" — are **user-scoped**. They are one person's preference, valuable to no one else.

**The Firewall Rule.** User-provided text is NEVER promoted to the global catalog on the AI's judgement alone. A 50-character answer can be "my mum's rent" — personal by construction. The default scope for anything learned from a user is user-scoped. Promotion to global requires the fact to be merchant-identity shaped AND corroborated by web evidence or by convergence across multiple users. This is the same principle as `data_collection: deny` provider routing (`config.py:19`): the user's data does not leak outward — including into our own shared catalog.

The engine already scopes name-based decisions per user (`cache_merchant(..., uid=uid)`, `categorisation.py:274`); the Firewall Rule generalises that discipline to every learned fact and makes global promotion the deliberate, corroborated exception.

A built-in category name is not, by itself, proof a merchant key is safe to share: the 2026-08-17 incident cached "MAINGI KM" globally under Income because Income is a built-in, and the account owner's own standing-order text then stood ready to poison categorisation for anyone else's colliding bank narrative. `cache_merchant` now gates every global write behind kind (spend-kind built-ins only, movement and income always stay per-user) and shape (a key that names or addresses a person, by owner-name match or payment-reference pattern, stays per-user regardless of category).

**The Destination Rule.** Spending gets vocabulary; movement gets destinations. Categories answer "what did you consume?" — and consumption has no account on the other end. Moved money always has an other end, and the engine can usually see it: own-transfer detection identifies the counterparty (`is_own_transfer`, `categorisation.py:149`), and the pot ledger knows which goal that account funds (`compute_pot_ledger`, `backend/app/routers/commitments.py`). So movement is never explained by a category — "£1,020 to WISE" does not become a House Fund *category*; it resolves to a destination: an existing pot/goal, a newly linked offline pot for accounts the engine cannot see (supported since goals v2, `manual_accounts_col`), or at minimum "an account of mine elsewhere" with no goal attached. The teaching flow forks on kind: a spend correction opens the naming picker; a movement resolution asks "is this account yours?" and links into the goal/pot system that already owns verification, payday legs and progress. Two parallel systems describing moved money — movement categories and the pot ledger — was the borrowed core leaking through; the ledger is canonical.

---

## The Ask Budget

**The Ask Budget Rule.** The user's attention is the most expensive resource in the ladder — more expensive than any model call. Ask only when a merchant is genuinely unresolved after web search AND the answer will be reused: a recurring merchant, or a material amount. A £2.50 one-off never earns a question. Asks are batched, frequency-capped, and skippable; an unanswered ask means the transaction sits quietly in "Other" until more evidence arrives. Never a blocking prompt, never a badged inbox, never a nag.

---

## Traceability

**The Show Your Working Rule.** Silent classification is only tolerable when every verdict can show its evidence. "Health: £228, 2.0× usual" must open onto the exact transactions that produced it, honestly scoped, with the scope stated. Overspend attribution ("mostly the £117 David Lloyd charge plus that weekend") is computed deterministically in Python — the LLM never does arithmetic (the house rule already enforced in `backend/app/routers/can_i.py:254`, "LLM never does arithmetic", and lines 316–318, "NEVER compute, derive or invent a figure"). The model narrates; Python counts. This is the categorisation-side application of BEHAVIOURS' **Facts / Voice Split**.

---

## What Dies / What Survives

Deletion, not relocation. These surfaces contradict the doctrine and go away:

- **The recurring-category trust grid.** A hand-maintained list of categories that widen recurring detection (`RECURRING_CATEGORY_OPTIONS`, 16 built-in chips plus customs, `frontend/components/CategoryManagerSheet.tsx:302`; default set `DEFAULT_RECURRING_CATEGORIES`, `backend/app/routers/analytics.py:431`). Regularity is the engine's job, not a checklist the user tends. Recurrence is defined internally — same merchant identity, amount tolerance, cadence tolerance, confidence tiers (`_detect_recurring`, `analytics.py:472`) — and the trust signal is the user's existing confirm/dismiss behaviour on bill predictions, learned, not configured.
- **The colour customiser as an advertised surface.** Colour becomes engine-assigned and deterministic from the category name — stable across devices, no `localStorage` (today's overrides live in `frontend/lib/colourStore.ts` via `localStorage`, `ColourProvider.tsx`). Colour is information (DESIGN's Category Voice Rule), so the engine owns it.
- **The typed natural-language rule builder.** (`/rules/parse` + `/rules`, `backend/app/routers/categories.py:225`.) Rules become engine-PROPOSED, not user-authored: "New Playtomic variant noticed — always file as Padel?", one tap to accept, shown with its blast radius, never auto-applied.
- **The standalone add-category flow and category deletion** (`add_category`, `categories.py:65`; `delete_category`, `categories.py:108`). Deprecated by the Born-in-Context Rule and the Retirement Rule: categories are born mid-correction and retire when unused, so a create button and a delete button have nowhere left to live. Together with the trust grid and the colour customiser above, this EMPTIES the Manage sheet (`CategoryManagerSheet.tsx`) — it is not simplified, it is left with nothing to hold and goes away.
- **Movement categories as user-facing vocabulary.** Under the Destination Rule, moved money resolves to a destination in the pot ledger, not a category — so Transfer, Savings, Investment and Debt stop being words the user files into or browses. The internal kinds remain (the arithmetic still needs "not spend"); what dies is the pretence that movement is a category to be named.

What survives, because each embodies the model rather than fighting it:

- **The category-kind chooser** (kinds in `backend/app/services/categories.py`). This is the naming/teaching moment — inferred, with one-tap confirm. It survives, but per the Born-in-Context Rule it now lives inside the correction picker on a real transaction, not on a standalone creation sheet. Keep it, move it.
- **The miscategorised guardrail card** (`miscategorised_count` / `miscategorised_list`, `transactions.py:252`). It IS the doctrine in miniature: the engine states a belief, the user confirms or corrects, the engine learns. Conditional, quiet, absent at zero, never an inbox.

---

## Current State (honest)

The doctrine is mostly aspiration today; the pipeline works but its learning loop is broken in three verifiable ways.

**No shared identity.** At least four code paths compute a *different* merchant identity for the same row, so five differently-formatted Playtomic lines are five different merchants to the engine:

- the similar-endpoint stem — `_description_stem`, `backend/app/routers/transactions.py:27`
- the cache key — `normalise_merchant`, `categorisation.py:247`
- the recurrence-series key — `series_key`, `categorisation.py:227`
- Pass 2.5's override key — the raw lowercased description, `categorisation.py:420` (no date stripping at all)

`merchant_key` is not stored on transactions at sync — it exists only inside `savings_insights.py` for a different feature. One shared identity function, written on every transaction at sync and indexed, is the prerequisite for the whole ladder: you cannot ask "what is Playtomic" or cache the answer if you cannot tell the five rows are one merchant.

**The cache gate throws away custom-category corrections.** `cache_merchant` returns early unless the category is in `VALID_CATEGORIES` (`categorisation.py:279`), and the correction endpoint gates its cache write on the same check (`transactions.py:232`). A user who recategorises to a custom category (Padel, Golf) has their correction saved on the row but NOT learned — so the same merchant is misfiled again on the next sync. The Two Inputs Rule is silently discarded for exactly the categories the user cared enough to create. The Haiku prompts are also built from `VALID_CATEGORIES` only (`categorise_others_bg`, `categorisation.py:677`), so the model is never even told a user's custom categories exist.

**Poisoned cache keys.** Keys built from raw descriptions can embed dates and reference numbers that never recur (the mechanism: `normalise_merchant` retains `A/C 76526682`-style numeric identity; several call sites cache from truncated raw labels, e.g. `categorise_others_bg` caches `normalise_merchant("", label)` at `categorisation.py:757`). Such a key can never match a future row, so the write is dead on arrival. *(The doctrine's "roughly a third poisoned" figure is a data claim, not verifiable from code alone — but the mechanism that produces poisoned keys is present and confirmed.)*

**Tier 3 exists but is bolted to the wrong place.** `tavily_lookup_merchants` (`categorisation.py:296`, `search_depth: "basic"`, one result) is wired only into the manual `/transactions/auto-categorise` endpoint (`transactions.py:369`), not into the sync-time ladder, and there is no reasoning tier on top of the search. Tier 4 (ask the user) does not exist for categorisation at all.

*Prompt cross-check: the recurring trusted-tier thresholds cited as "~line 532" are actually the acceptance logic at `analytics.py:537–550` (line 532 is a comment); everything else in the brief verified at the lines given.*

---

## Build Order

Each stage ships value on its own.

1. **Identity.** `merchant_key` — one shared identity function, stored at sync, indexed — plus the cache-gate fix (learn custom categories) and custom categories injected into the LLM prompt. Fixes the broken loop; unblocks everything below.
2. **The ladder + scoped learning + the teaching-event stream.** Tiers 1–3 in sequence at sync time, with the global/user split and the Firewall Rule enforced on every write — all reading from one uniform teaching-event stream (the One Stream Rule) so every signal feeds the ladder the same way.
3. **The ask tier.** Tier 4, governed by the Ask Budget Rule — batched, capped, skippable.
4. **Internalised recurrence + granular attribution.** Retire the trust grid; define regularity from `merchant_key` + cadence; compute overspend attribution deterministically in Python for the Show Your Working Rule.
