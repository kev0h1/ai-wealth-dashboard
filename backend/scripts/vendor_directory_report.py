#!/usr/bin/env python3
"""G316: read-only before/after report of the owner's categories under the ladder.

Resolves the account owner from PRIMARY_EMAIL (never printed), reads their open
debit transactions, runs the ladder as a DRY RUN and writes a markdown report.

Read-only guarantees:
* the ladder runs with dry_run=True, so no transaction, decision or rule is written;
* every collection the lookup path would write (vendors, claims, lookup state,
  LLM and Tavily usage metering) is replaced by an in-memory fake, so the real
  database is only ever read;
* only the report file named by --out is written.

Modes:
* default (live): at most --max-lookups (default 20) real Tavily searches plus
  reasoning-model write-ups, then one cheap-model match call per batch of 20. The
  report states the number of calls and the metered model cost.
* --simulate: no Tavily and no model. A fixed word list stands in for the directory
  description (golf means a golf club, and so on) and a word match stands in for the
  matcher. It shows the plumbing (which rows are open to the ladder and which would
  move IF the directory describes them that way), and says nothing about model quality.
* --no-live: no calls at all; merchants show as "not looked up".

Output never contains a user id, email, amount or account number, and merchants
that trip a privacy exclusion (person payments, the owner's name, account digits)
are counted but never named.

Usage (from backend/):
    .venv/bin/python scripts/vendor_directory_report.py --env-file .env --out ../docs/engine/vendor-directory-report.md
"""
import argparse
import asyncio
import re
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

_SPORT_RE = re.compile(
    r"golf|tennis|padel|squash|badminton|swim|leisure|\bsports?\b|\bsporting\b|\bclub\b|yoga|pilates|crossfit|\bgym\b|playtomic|fitness", re.I)
_OPEN_CATEGORIES = {None, "Health", "Entertainment", "Other"}
# --simulate only: merchant words and the description a stand-in directory would hold.
_SIM_LEXICON = [
    (re.compile(r"golf"), "Golf club or golf course."),
    (re.compile(r"padel|playtomic"), "Padel court booking and venue."),
    (re.compile(r"tennis|squash|badminton"), "Racket sports club."),
    (re.compile(r"gym|fitness|david lloyd|leisure|sport"), "Gym, leisure or sports centre."),
]


def _esc(text: str) -> str:
    return str(text or "").replace("|", "/").replace("\n", " ")


async def build_report(uid: str, *, max_lookups: int, live: bool, simulate: bool = False) -> tuple[str, dict]:
    from app.core import config as cfg
    from app.core import llm as core_llm
    from app.services import categorisation as cat
    from app.services import vendor_directory as vd
    from scripts.inmemory_mongo import InMemoryCollection as Col

    # Nothing the lookup path writes may reach the real database.
    mem = {n: Col(n) for n in ("vendors", "decisions", "claims", "state", "usage", "global_usage")}
    vd.vendors_col, vd.user_vendor_categories_col = mem["vendors"], mem["decisions"]
    vd.vendor_claims_col, vd.worker_runs_col = mem["claims"], mem["state"]
    core_llm.llm_usage_col, core_llm.llm_global_usage_col = mem["usage"], mem["global_usage"]
    core_llm._indexes_ready = True
    cfg.VENDOR_LOOKUP_CAP_PER_DAY = max(max_lookups, 1)
    cfg.VENDOR_LOOKUP_CAP_PER_SYNC = max(max_lookups, 1)
    cfg.VENDOR_MATCH_CAP_PER_SYNC = 10_000

    allowed, _kinds, identity, groups = await vd._gather(uid)
    corrected = await vd._corrected_keys(uid)
    rules = await vd._rule_patterns(uid)
    customs = [c for c in allowed if c not in cat.VALID_CATEGORIES]

    before = Counter()
    for g in groups.values():
        for c, n in g["cats"].items():
            before[c or "Uncategorised"] += n

    # Choose which merchants get a real lookup: sport and leisure wording first,
    # then the broad Health/Entertainment/Other bucket, busiest first.
    eligible = []
    for key, g in groups.items():
        if key in corrected or any(p.search(t.lower()) for p in rules for t in g["texts"]):
            continue
        top = g["cats"].most_common(1)[0][0]
        if vd.privacy_exclusion(key, g["texts"], category=top, identity=identity,
                                own_account_id=next(iter(g["accounts"]), None)):
            continue
        rank = 0 if _SPORT_RE.search(key) else (1 if top in _OPEN_CATEGORIES else 2)
        eligible.append((rank, -len(g["ids"]), key))
    eligible.sort()
    sampled = {k for _r, _n, k in eligible[:max_lookups]} if live else set()

    # Every golf and sport merchant the owner has, corrected rows included, so the
    # page shows where each one stands today. Read-only.
    from app.db.collections import transactions_col as _txns
    sport_rows: dict[str, Counter] = {}
    private_sport = 0
    for t in await _txns.find(
        {"user_id": uid, "transaction_type": "debit"},
        {"merchant_name": 1, "description": 1, "category": 1, "custom_category": 1, "account_id": 1},
    ).to_list(None):
        key = cat.canonical_merchant_key(t.get("merchant_name") or "", t.get("description") or "")
        if not key or not _SPORT_RE.search(key):
            continue
        text = " ".join(x for x in [t.get("merchant_name"), t.get("description")] if x)
        if vd.privacy_exclusion(key, [text], category=t.get("category"), identity=identity,
                                own_account_id=t.get("account_id")):
            private_sport += 1
            continue
        eff = t.get("custom_category") or t.get("category") or "Uncategorised"
        sport_rows.setdefault(key, Counter())[(eff, bool(t.get("custom_category")))] += 1

    lookups = 0

    async def ensure(key, budget, now):
        nonlocal lookups
        if key not in sampled:
            return None, "not_sampled"
        doc, why = await vd.ensure_vendor(key, budget, now)
        if why is None:
            lookups += 1
        return doc, why

    async def sim_ensure(key, budget, now):
        nonlocal lookups
        desc = next((d for pat, d in _SIM_LEXICON if pat.search(key)), None)
        if key not in sampled or not desc:
            return None, "no_simulated_entry"
        doc = {"_id": key, "merchant_key": key, "display_name": key.title(), "description": desc,
               "type_tags": [], "domain": None, "sources": [], "confidence": "low", "status": "found",
               "looked_up_at": now, "version": 1}
        mem["vendors"].docs[key] = doc
        lookups += 1
        return doc, None

    async def sim_match(_uid, allowed_cats, items):
        out = {}
        for i, it in enumerate(items):
            words = set(re.findall(r"[a-z]+", it["description"].lower()))
            pick = next((c for c in allowed_cats if c not in cat.VALID_CATEGORIES and c.lower() in words), None)
            if pick:
                out[i] = (pick, "Simulated: the description names this category.")
        return out

    if simulate:
        sampled = {k for k, g in groups.items() if k in {e[2] for e in eligible}
                   and any(pat.search(k) for pat, _d in _SIM_LEXICON)}
    stats = await vd.run_vendor_ladder(
        uid, dry_run=True, allow_lookups=live or simulate, allow_match=live or simulate,
        budget=vd.SyncBudget(max_lookups if not simulate else 10_000),
        ensure_fn=sim_ensure if simulate else ensure,
        match_fn=sim_match if simulate else None,
    )

    cost = sum(float(d.get("cost_usd") or 0) for d in mem["usage"].docs.values())
    model_calls = sum(1 for d in mem["usage"].docs.values() if d.get("model") != "tavily")
    tavily_calls = sum(1 for d in mem["usage"].docs.values() if d.get("model") == "tavily")

    proposals = {p["merchant_key"]: p for p in stats["proposals"]}
    after = Counter(before)
    moved_rows = 0
    for key, p in proposals.items():
        if p["proposed_category"] in (None, "Other"):
            continue
        g = groups.get(key)
        if not g:
            continue
        for c, n in g["cats"].items():
            if c != p["proposed_category"]:
                after[c or "Uncategorised"] -= n
                after[p["proposed_category"]] += n
                moved_rows += n

    out = []
    w = out.append
    w("# Vendor directory report (G316)")
    w("")
    w(f"Generated {datetime.now(timezone.utc).strftime('%Y-%m-%d')} by `backend/scripts/vendor_directory_report.py`. "
      "Read-only: nothing was written to transactions, rules, decisions or the directory. The owner of the "
      "primary account is the subject; no identifiers appear here.")
    w("")
    w("## How this was produced")
    w("")
    if simulate:
        w("- **Simulation. No web search and no model call was made.** The Tavily quota has been exhausted since "
          "16 Oct (HTTP 432, the B44 backoff was live) and the OpenRouter key on this host is currently rejected "
          "(HTTP 401, the account is not found), so neither the live lookup nor the model could run. A fixed word "
          "list stands in for the directory description (a name with golf in it is described as a golf club, "
          "and so on) and a word match stands in for the matcher (it picks your category named in the "
          "description). This shows the plumbing only: which rows the ladder is allowed to touch, and which would "
          "move IF the directory describes the merchant that way. It says nothing about how well the real "
          "reasoning model or matcher will do.")
        w(f"- Merchants given a stand-in description: **{lookups}**.")
    elif live:
        w(f"- The ladder ran as a dry run with **real** web lookups for at most {max_lookups} merchants, chosen "
          "by sport and leisure wording first (golf, tennis, padel, gym, club and so on), then the broad "
          "Health, Entertainment and Other bucket, busiest first.")
        w(f"- Calls made: **{tavily_calls} Tavily searches** (basic depth, one credit each) and "
          f"**{model_calls} model calls** (reasoning model for each description, cheap model for the matches). "
          f"Metered OpenRouter cost for this run: **${cost:.4f}**.")
        w("- Descriptions and matches lived in memory only. Run the real thing and the same descriptions are "
          "written once to the shared directory.")
    else:
        w("- No live lookups or model calls were made (`--no-live`). Merchants show as not looked up.")
    w(f"- The owner's custom categories offered to the matcher: {', '.join(customs) if customs else 'none'}.")
    w("")
    w("## What the ladder looked at")
    w("")
    w(f"- Open debit rows (no hand correction): **{stats['rows']}** across **{stats['merchants']}** merchants.")
    w(f"- Left alone because the owner already corrected the merchant: **{stats['corrected_skipped']}** merchants.")
    w(f"- Left alone because a user rule covers them: **{stats['rule_skipped']}** merchants.")
    priv = stats["private_skipped"]
    w("- Never sent anywhere (privacy exclusions, not named here): "
      + (", ".join(f"{n} {k.replace('_', ' ')}" for k, n in sorted(priv.items())) or "none") + ".")
    w(f"- Merchants that would need a directory lookup in a real run: **{stats['needs_lookup']}**; looked up for "
      f"this report: **{lookups}**.")
    if stats["deferred"]:
        w("- Lookups not made, by reason: " + ", ".join(f"{n} {k.replace('_', ' ')}" for k, n in sorted(stats["deferred"].items())) + ".")
    w(f"- Rows the proposals below would move: **{moved_rows}**.")
    w("")
    w("## Before and after, by category (open debit rows)")
    w("")
    w("| Category | Before | After (looked-up merchants only) |")
    w("|---|---:|---:|")
    for c in sorted(set(before) | set(after), key=lambda c: -max(before.get(c, 0), after.get(c, 0))):
        if before.get(c, 0) or after.get(c, 0):
            mark = "" if before.get(c, 0) == after.get(c, 0) else " (changed)"
            w(f"| {_esc(c)} | {before.get(c, 0)} | {after.get(c, 0)}{mark} |")
    w("")
    w("## Golf and sport merchants today")
    w("")
    w("Every golf, sport and leisure merchant, hand-corrected rows included. A corrected row keeps the "
      "category you gave it and is never touched. `Proposed` is for the rows still open to the ladder.")
    w("")
    w("| Merchant | Rows now | Hand-corrected | Category now | Proposed for open rows |")
    w("|---|---:|---:|---|---|")
    for key in sorted(sport_rows, key=lambda k: -sum(sport_rows[k].values())):
        counts = sport_rows[key]
        total = sum(counts.values())
        corrected_n = sum(n for (_c, hand), n in counts.items() if hand)
        by_cat = Counter()
        for (c, _h), n in counts.items():
            by_cat[c] += n
        now_cats = ", ".join(f"{c} {n}" for c, n in by_cat.most_common())
        p = proposals.get(key)
        proposed = (p["proposed_category"] if p and p["proposed_category"] not in (None, "Other") else
                    ("none open" if corrected_n == total else "no change proposed"))
        d = mem["vendors"].docs.get(key)
        w(f"| {_esc((d or {}).get('display_name') or key.title())} | {total} | {corrected_n} | {_esc(now_cats)} | {_esc(proposed)} |")
    if private_sport:
        w("")
        w(f"{private_sport} further sport-worded row(s) were excluded by the privacy rules (for example a "
          "person-to-person payment with golf in the reference) and are not named.")
    w("")
    w("## Merchant by merchant (looked-up merchants)")
    w("")
    w("| Merchant (directory name) | Rows | Current category | Proposed category | Reason |")
    w("|---|---:|---|---|---|")
    shown = sorted(proposals.values(), key=lambda p: (p["proposed_category"] == p["current_category"], -p["rows"]))
    for p in shown:
        w(f"| {_esc(p['display_name'])} | {p['rows']} | {_esc(p['current_category'] or 'Uncategorised')} | "
          f"{_esc(p['proposed_category'])} | {_esc(p['reason'])} |")
    if not shown:
        w("| (none) | | | | |")
    w("")
    w("## Looked up, no category change")
    w("")
    nf = [k for k in sampled if k not in proposals]
    docs = mem["vendors"].docs
    if nf:
        w("| Merchant | Directory result |")
        w("|---|---|")
        for k in sorted(nf):
            d = docs.get(k)
            result = "not looked up (cap or backoff)" if not d else (
                d["status"].replace("_", " ") + (f": {_esc(d.get('description'))}" if d.get("description") else ""))
            w(f"| {_esc((d or {}).get('display_name') or k.title())} | {result} |")
    else:
        w("None.")
    w("")
    w("## Descriptions written")
    w("")
    w("| Merchant | Description | Tags | Confidence |")
    w("|---|---|---|---|")
    for d in sorted(docs.values(), key=lambda d: d["merchant_key"]):
        if d.get("status") == "found":
            w(f"| {_esc(d['display_name'])} | {_esc(d['description'])} | {_esc(', '.join(d.get('type_tags') or []))} "
              f"| {d.get('confidence')} |")
    w("")
    w("## For Kevin to check")
    w("")
    w("Kevin confirms categorisation changes, so this report is the gate. Check that the golf rows (West "
      "Midlands Golf Club, Stonebridge, Widney Manor and any other golf merchant) land in Golf in the table "
      "above, that nothing you corrected by hand appears as a proposal, and that no proposal files a "
      "business in a custom category it does not belong in. Reasons come from the matcher, not from rules.")
    return "\n".join(out) + "\n", {"lookups": lookups, "tavily": tavily_calls, "model_calls": model_calls, "cost": cost}


async def _main(out_path: str, max_lookups: int, live: bool, simulate: bool) -> int:
    from app.core.config import PRIMARY_EMAIL
    report, meta = await build_report(PRIMARY_EMAIL, max_lookups=max_lookups, live=live, simulate=simulate)
    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    Path(out_path).write_text(report)
    print(f"wrote report: lookups={meta['lookups']} tavily={meta['tavily']} model_calls={meta['model_calls']} "
          f"cost_usd={meta['cost']:.4f}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--env-file", default=None)
    ap.add_argument("--out", default="../docs/engine/vendor-directory-report.md")
    ap.add_argument("--max-lookups", type=int, default=20)
    ap.add_argument("--no-live", action="store_true", help="make no Tavily or model calls")
    ap.add_argument("--simulate", action="store_true",
                    help="no Tavily and no model: a word list stands in for the directory (plumbing check only)")
    args = ap.parse_args()
    if args.env_file:
        from dotenv import load_dotenv
        load_dotenv(args.env_file, override=False)
    return asyncio.run(_main(args.out, args.max_lookups, not args.no_live, args.simulate))


if __name__ == "__main__":
    sys.exit(main())
