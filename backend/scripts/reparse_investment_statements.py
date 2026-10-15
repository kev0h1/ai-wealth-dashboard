#!/usr/bin/env python3
"""G278: capture the statement period (opening value, payments in, fees,
interest, dated purchases) for investment accounts uploaded before the parser
read them.

THE TRUTH ABOUT WHAT CAN BE RE-READ. The statement upload keeps neither the
PDF nor its extracted text: investment_upload parses, stores the holdings and
the closing value, and discards the document. So for an account uploaded
before G278 there is nothing stored to re-parse, and this script says so. The
period fields only appear when the user (or an operator with the user's
statement) uploads that statement again. This script re-reads stored text only
if an account document carries it (`statement_text`, which nothing writes
today, so it is a hook rather than a feature), or a local PDF/text file passed
with --file for one named account.

Dry run is the default and prints counts and account ids only, never names,
values or user ids. --apply merges the period into the account's
`statement_periods` (idempotent: one period per closing date, a second run
changes nothing). Parsing goes through the same llm_parse_investment_statement
the upload uses, so --apply with a file makes one OpenRouter call.

Usage (from backend/):
    .venv/bin/python scripts/reparse_investment_statements.py
    .venv/bin/python scripts/reparse_investment_statements.py --apply
    .venv/bin/python scripts/reparse_investment_statements.py --account ACC_ID --file statement.pdf [--password X] --apply
"""
import argparse
import asyncio
import sys
from pathlib import Path

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))


def classify(acc: dict) -> str:
    """'has_period' | 'has_text' | 'needs_reupload'."""
    if acc.get("statement_periods"):
        return "has_period"
    if str(acc.get("statement_text") or "").strip():
        return "has_text"
    return "needs_reupload"


def plan(accounts: list[dict]) -> dict:
    out = {"has_period": [], "has_text": [], "needs_reupload": []}
    for a in accounts:
        out[classify(a)].append(a["_id"])
    return out


async def parse_into(acc: dict, text: str) -> dict | None:
    """Parse one statement's text and return the account's new statement_periods, or None."""
    from app.services import investment_anchor as ia
    from app.services.pdf import llm_parse_investment_statement
    parsed = await llm_parse_investment_statement(text)
    closing = ia.as_date(parsed.get("statement_date"))
    try:
        total = float(parsed.get("total_value") or 0)
    except (TypeError, ValueError):
        total = None
    period = ia.clean_period(parsed, total, closing)
    if period is None:
        return None
    return {"statement_periods": ia.upsert_period(acc.get("statement_periods"), period)}


async def main(args) -> int:
    from app.db.collections import investment_accounts_col
    accounts = await investment_accounts_col.find({"_id": args.account} if args.account else {}).to_list(None)
    if args.file:
        if not args.account or len(accounts) != 1:
            print("--file needs --account naming exactly one existing account.")
            return 2
        from app.services.pdf import extract_pdf_text
        raw = Path(args.file).read_bytes()
        text = (await extract_pdf_text(raw, password=args.password or "")) if raw[:4] == b"%PDF" else raw.decode("utf-8-sig", "replace")
        if not text.strip():
            print("Could not read any text from that file.")
            return 2
        texts = {accounts[0]["_id"]: text}
    else:
        texts = {a["_id"]: a["statement_text"] for a in accounts if classify(a) == "has_text"}
    p = plan(accounts)
    print(f"accounts: {len(accounts)}  already have a period: {len(p['has_period'])}  "
          f"stored text to re-read: {len(p['has_text'])}  need the statement uploaded again: {len(p['needs_reupload'])}")
    if p["needs_reupload"] and not args.file:
        print("The upload does not keep the PDF or its text, so those accounts cannot be re-read here. "
              "Upload the statement again in Accounts, or pass --account ID --file statement.pdf.")
    todo = [a for a in accounts if a["_id"] in texts]
    if not args.apply:
        print(f"dry run: {len(todo)} account(s) would be re-parsed. Nothing written. Add --apply to write.")
        return 0
    written = 0
    for a in todo:
        upd = await parse_into(a, texts[a["_id"]])
        if upd is None:
            print(f"{a['_id']}: no statement date found, skipped")
            continue
        await investment_accounts_col.update_one({"_id": a["_id"]}, {"$set": upd})
        written += 1
    print(f"applied: {written} account(s) updated")
    return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--apply", action="store_true", help="write the periods (default is a dry run)")
    ap.add_argument("--account", help="limit to one investment account id")
    ap.add_argument("--file", help="a local statement PDF or text file for --account")
    ap.add_argument("--password", help="PDF password for --file")
    sys.exit(asyncio.run(main(ap.parse_args())))
