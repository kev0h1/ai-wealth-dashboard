"""G315: renders docs/copy/tips-review-2026-10.md for Kevin's sign-off. Not a test.

  1. BEFORE, from the pre-G315 code (a copy of the base commit on PYTHONPATH):
       PYTHONPATH=/tmp/g315-before/backend:. python tests/g315_review_render.py --before /tmp/g315-before.json
  2. The document, from the current code plus that JSON, plus a READ-ONLY render of the
     owner's cached tips (reads only, never a write, prints names, amounts, dates, sources
     and the rendered strings, never ids or emails):
       python tests/g315_review_render.py --doc docs/copy/tips-review-2026-10.md [--uat]
"""
import asyncio
import json
import os
import sys
from datetime import datetime, timedelta

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

TODAY = datetime(2026, 10, 21)


def _before(path):
    import app.routers.savings_insights as old
    from tests.g315_fixtures import CASES, doc
    out = {}
    for cat, (name, rows, findings) in CASES.items():
        oldfind = dict(findings)
        c = old._compose_tip_content(cat, doc(oldfind), rows, None, TODAY.date())
        total = sum(r["monthly_amount"] for r in rows)
        if len(rows) > 1:
            lead = f"~£{total:,.0f}/mo across {len(rows)} places"
        else:
            lead = f"~£{rows[0]['monthly_amount']:,.0f}/mo at {rows[0]['display_name']}"
        exp = old._expiry_line(datetime(2026, 10, 16, 9), datetime(2026, 10, 23, 9), None, TODAY)
        out[cat] = {"lead": lead + " · from your transactions", "title": c["title"] if c else None,
                    "body": c["body"] if c else None, "expiry": exp}
    json.dump(out, open(path, "w"), ensure_ascii=False)


def _after(cat):
    import app.routers.savings_insights as si
    from tests.g315_fixtures import CASES, doc
    name, rows, findings = CASES[cat]
    c = si._compose_tip_content(cat, doc(findings), rows, None, TODAY.date())
    if c is None:
        return None
    now = datetime.utcnow()  # naive-ok: render-only
    s = si._serialize_insight({
        "_id": "x", "insight_id": f"{cat}-x", "category": cat, "pinned": False, "is_new": False,
        "refreshed_at": now, "researched_at": now - timedelta(days=5), "content_valid_until": now + timedelta(days=2),
        "triggered_by": rows, "prompt_version": si.PROMPT_VERSION, "title": c["title"], "body": c["body"]})
    return s


def _fmt_after(s):
    if s is None:
        return ["- (no tip: nothing factual to say)"]
    lines = [f"- Lead: {s['lead_line']} · from your transactions", f"- Headline: {s['title']}" if s["title"] != s["lead_line"] else "- Headline: (same sentence as the lead, shown once)",
             f"- Body: {s['body']}", f"- Freshness line below the body: {s['expiry_line'] or '(none, the body carries the one \"Checked\" line)'}"]
    return lines


async def _uat():
    from dotenv import dotenv_values
    v = dotenv_values("/root/ai-wealth-dashboard/backend/.env")
    for k, val in v.items():
        if val is not None:
            os.environ.setdefault(k, val)
    import app.routers.savings_insights as si
    from app.core.config import PRIMARY_EMAIL
    from app.db.collections import savings_insights_col, tip_research_col
    uid = PRIMARY_EMAIL  # the owner, looked up from the environment and never printed
    docs = await savings_insights_col.find({"user_id": uid, "retired_at": {"$exists": False}}).to_list(None)
    out = []
    for d in sorted(docs, key=lambda x: x.get("category", "")):
        cat = d["category"]
        cfg = si.INSIGHT_CATEGORIES.get(cat)
        if not cfg:
            continue
        old_tb = d.get("triggered_by") or []
        old_total = sum(float(t.get("monthly_amount") or 0) for t in old_tb)
        old_lead = (f"~£{old_total:,.0f}/mo across {len(old_tb)} places" if len(old_tb) > 1
                    else (f"~£{old_total:,.0f}/mo at {old_tb[0].get('display_name')}" if old_tb else "(no lead)"))
        out.append(f"#### {cfg['label']}")
        out.append("")
        out.append("Now (as served today, from the cached tip):")
        out.append(f"- Lead: {old_lead} · from your transactions")
        out.append(f"- Headline: {d.get('title')}")
        out.append(f"- Body: {d.get('body')}")
        out.append(f"- Rows: " + "; ".join(f"{t.get('display_name')} £{float(t.get('monthly_amount') or 0):,.2f}" for t in old_tb))
        out.append("")
        out.append("After G315 (what the next weekly pass would write, from his current transactions and the cached shared research; nothing is written):")
        triggered = await si._find_triggered_transactions(uid, cat)
        regulated = si.tip_facts.is_regulated_category(cat, cfg["label"])
        if regulated:
            now = datetime.utcnow()  # naive-ok: render-only
            rdoc = {"as_of": TODAY.date().isoformat(), "fetched_at": now, "content_valid_until": now + timedelta(days=7), "findings": {}}
        else:
            key = await si._tip_key_for(uid, cat, triggered)
            r = await tip_research_col.find_one({"_id": key.doc_id})
            rdoc = r if r and r.get("findings") else None
        if rdoc is None:
            out.append("- (no cached shared research for this tip yet, so the weekly pass would fetch it, then show the user's own fact and any like-for-like listing)")
            c = si._compose_tip_content(cat, {"as_of": TODAY.date().isoformat(), "fetched_at": None, "content_valid_until": None, "findings": {}},
                                        triggered, d.get("user_context"), TODAY.date())
            out.append(f"- Own-fact only: {si.tip_facts.sentence(c['title']) + ' ' + c['body'] if c else '(no tip)'}")
        else:
            c = si._compose_tip_content(cat, rdoc, triggered, d.get("user_context"), TODAY.date())
            if c is None:
                out.append("- (no tip)")
            else:
                s = si._serialize_insight({
                    "_id": "x", "insight_id": "x", "category": cat, "pinned": False, "is_new": False,
                    "refreshed_at": datetime.utcnow(), "researched_at": datetime.utcnow(),  # naive-ok: render-only
                    "content_valid_until": datetime.utcnow() + timedelta(days=5),  # naive-ok: render-only
                    "triggered_by": triggered, "prompt_version": si.PROMPT_VERSION, "title": c["title"], "body": c["body"]})
                out += _fmt_after(s)
                out.append(f"- Rows: " + "; ".join(f"{t['display_name']} £{t['monthly_amount']:,.2f}" for t in s["triggered_by"]))
                srcs = (rdoc.get("findings") or {}).get("sources") or []
                if srcs and not regulated:
                    names = si.tip_facts.source_names(srcs)
                    dropped = [u for u in srcs if not si.tip_facts.allowed_source_name(u)]
                    out.append(f"- Sources kept: {', '.join(names) or '(none)'}; dropped as not allowlisted: {len(dropped)}")
        out.append("")
    return out


def _doc(path, uat):
    from tests.g315_fixtures import CASES
    before = json.load(open("/tmp/g315-before.json"))
    L = ["# Tips review, October 2026 (G315)", "",
         "Status: awaiting Kevin's sign-off. Nothing here is live. Every figure in the synthetic section is invented; the last section is a read-only render of the owner's own cached tips.",
         "",
         "Rules applied (Kevin, 2026-10-21):", "",
         "- (a) Mortgage, car finance and loans, credit cards and balance transfers, insurance, pensions and investments show only the user's own fact, or no tip. No market list, no broker link, no research query for them.",
         "- (b) Also listed appears only when it is like for like: same product type, a stated monthly price, a named reputable source. Never a product type without a price, a voucher or reseller, or a basket average beside the user's spend. A mobile, broadband or energy bill is not known to be like for like with a market plan (it may include a handset, a bundle or usage), so those carry no Also listed line unless the user has said what their plan is.",
         "- (c) One figure per card: the headline and the lead line are the same sentence; no 'across N places'.",
         "- (d) Cleaned merchant names, one row per brand; an unknown lender reads 'your mortgage lender'.",
         "- (e) Sources show names (MoneySuperMarket, Which?), only from the allowlist; SEO price sites are dropped, and with no allowed source the market lines are dropped.",
         "- (f) One freshness line: 'Checked 16 Oct'.",
         "",
         "Cache: stored tips below prompt version 9 are never served, so they show as no tip until the weekly pass rewrites them.",
         "", "## Synthetic fixtures, before and after", ""]
    for cat, (name, rows, findings) in CASES.items():
        b = before[cat]
        L += [f"### {name}", "", "Before:", f"- Lead: {b['lead']}", f"- Headline: {b['title']}", f"- Body: {b['body']}",
              f"- Freshness line below the body: {b['expiry']}", "", "After:"] + _fmt_after(_after(cat)) + [""]
    if uat:
        L += ["## Your own tips on UAT (read-only render)", "",
              "Read from the owner's cached tips. Nothing was written. The 'After' text is what the next weekly pass would write.", ""]
        L += asyncio.run(_uat())
    open(path, "w", encoding="utf-8").write("\n".join(L) + "\n")


if __name__ == "__main__":
    if "--before" in sys.argv:
        _before(sys.argv[sys.argv.index("--before") + 1])
    else:
        _doc(sys.argv[sys.argv.index("--doc") + 1], "--uat" in sys.argv)
