#!/usr/bin/env python3
"""B48: seed the shared tip_research collection from existing per-user tips.

Dry-run by default (reads only, prints counts). `--apply` writes. Idempotent:
a second run changes nothing. Output is counts only, never user ids, names,
amounts or tip text.

What it can honestly do. An existing per-user tip is a personalised sentence
mixing market facts with the user's own figures, and carries no structured
findings. So the backfill derives the shared key (category, provider from the
curated trigger list, coarse price band, or behaviour profile) in memory and
copies ONLY the sentences of the tip body that are free of the user: no
second-person wording, none of the user's amounts (nor their yearly or monthly
equivalents), none of their merchant names or the values they typed into the
workflow context, and no dated promotion. Titles and savings estimates are
never copied (they lead with the user's figure). Anything else is dropped.
A seed expires with the tip it came from (7 days after its research date), is
only written for tips still in date, and is replaced by the first real fetch,
so its value is a head start for the first week after release, not a store of
history. A key that already has its own findings is left alone.

Usage (from backend/):
    .venv/bin/python scripts/backfill_tip_research.py [--env-file .env]
    .venv/bin/python scripts/backfill_tip_research.py --apply
"""
import argparse
import asyncio
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

_SECOND_PERSON = re.compile(r"\b(?:you|your|you're|you've|yours|yourself)\b", re.IGNORECASE)
_TOLERANCE = 0.5


def market_sentences(doc: dict) -> list[str]:
    """The body sentences of a stored tip that mention nothing of the user."""
    from app.routers import savings_insights as si

    user_numbers: set[float] = set()
    user_strings: set[str] = set()
    for t in doc.get("triggered_by") or []:
        for field in ("monthly_amount",):
            if t.get(field) is not None:
                user_numbers.add(round(float(t[field]), 2))
        for field in ("merchant_key", "display_name"):
            v = str(t.get(field) or "").strip().lower()
            if len(v) >= 2:
                user_strings.add(v)
    for v in (doc.get("user_context") or {}).values():
        user_numbers.update(si._extract_numbers(str(v)))
        sv = str(v).strip().lower()
        if len(sv) >= 3:
            user_strings.add(sv)
    for n in list(user_numbers):
        user_numbers.add(round(n * 12, 2))
        user_numbers.add(round(n / 12, 2))

    out: list[str] = []
    for sent in re.split(r"(?<=[.!?])\s+", str(doc.get("body") or "")):
        s = si._house_style(sent).replace("!", ".").strip()
        low = s.lower()
        if not s or len(s) > 200 or s.startswith("Market check"):
            continue
        if _SECOND_PERSON.search(s):
            continue
        if any(u in low for u in user_strings):
            continue
        if any(abs(n - u) <= _TOLERANCE for n in si._extract_numbers(s) for u in user_numbers):
            continue
        if si._DATED_PROMO_RE.search(s) or si._NON_UK_RE.search(s) or si._CARD_DEBT_MOVE_RE.search(s):
            continue
        out.append(s)
    return out[:2]


async def backfill(insights_col, apply: bool, now: datetime | None = None) -> dict:
    from app.routers import savings_insights as si
    from app.services import tip_research

    now = now or datetime.now(timezone.utc).replace(tzinfo=None)  # naive-ok: stored values are naive UTC
    counts = {"tips": 0, "not_in_date": 0, "resolved_or_retired": 0, "no_key": 0,
              "no_market_text": 0, "keys_seeded": 0, "keys_already_covered": 0}
    docs = await insights_col.find({}).to_list(None)
    counts["tips"] = len(docs)
    for d in docs:
        cat = d.get("category")
        researched_at = d.get("researched_at")
        valid_until = d.get("content_valid_until")
        if cat not in si.INSIGHT_CATEGORIES or not researched_at or not valid_until or valid_until <= now:
            counts["not_in_date"] += 1
            continue
        if d.get("retired_at") or d.get("verified_at") or d.get("substituted_at"):
            counts["resolved_or_retired"] += 1
            continue
        if not (d.get("title") or "").strip() or not (d.get("body") or "").strip():
            counts["not_in_date"] += 1
            continue
        try:
            key = await si._tip_key_for(d.get("user_id") or "", cat, d.get("triggered_by"))
        except Exception:
            counts["no_key"] += 1
            continue
        sentences = market_sentences(d)
        if not sentences:
            counts["no_market_text"] += 1
            continue
        findings = {
            "typical_low": None, "typical_high": None, "headline": " ".join(sentences)[:240],
            "alternatives": [], "deal": None, "sources": [],
        }
        wrote = await tip_research.seed(
            key, findings, fetched_at=researched_at, claim_valid_until=None, dry_run=not apply,
        )
        counts["keys_seeded" if wrote else "keys_already_covered"] += 1
    return counts


async def _main(apply: bool) -> int:
    from app.db.collections import db, savings_insights_col
    print(f"database: {db.name}  mode: {'APPLY' if apply else 'dry-run'}")
    counts = await backfill(savings_insights_col, apply)
    for k, v in counts.items():
        print(f"  {k}: {v}")
    if not apply:
        print("dry-run: nothing written. Re-run with --apply to write.")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--apply", action="store_true", help="write changes (default is dry-run)")
    ap.add_argument("--env-file", default=None, help="path to a .env to load first")
    args = ap.parse_args()
    if args.env_file:
        from dotenv import load_dotenv
        load_dotenv(args.env_file, override=False)
    return asyncio.run(_main(args.apply))


if __name__ == "__main__":
    sys.exit(main())
