"""PDF text extraction and LLM statement parsing."""
import json
import re
import tempfile
import subprocess
import os
from fastapi import HTTPException
import httpx

from app.core.config import OPENROUTER_API_KEY


async def extract_pdf_text(content: bytes, password: str = "") -> str:
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as f:
        f.write(content)
        tmp_path = f.name
    try:
        cmd = ["pdftotext", "-layout"]
        if password:
            cmd += ["-upw", password]
        cmd += [tmp_path, "-"]
        result = subprocess.run(cmd, capture_output=True, timeout=30)
        if result.returncode != 0 and password:
            result = subprocess.run(
                ["pdftotext", "-layout", "-opw", password, tmp_path, "-"],
                capture_output=True, timeout=30,
            )
        return result.stdout.decode("utf-8", errors="replace")
    finally:
        os.unlink(tmp_path)


async def llm_parse_mpesa(text: str) -> list[dict]:
    prompt = (
        "You are a financial data extraction assistant. Below is raw text from an M-Pesa "
        "statement (Safaricom Kenya mobile money). Extract ALL transactions and return ONLY "
        "a valid JSON array with no extra text. Each object must have exactly these fields:\n"
        "  receipt: string (transaction ID / receipt number, or generate 'TXN-<index>' if missing)\n"
        "  date: string (ISO 8601, e.g. '2024-03-15T14:30:00')\n"
        "  type: 'credit' or 'debit' (credit = money received, debit = money sent/paid)\n"
        "  amount: number (positive, KES)\n"
        "  description: string (full details/narration)\n"
        "  balance: number or null (running balance after transaction)\n"
        "Ignore header rows, footers, and non-transaction lines.\n\n"
        "STATEMENT TEXT:\n" + text[:12000]
    )
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            r = await client.post(
                "https://openrouter.ai/api/v1/chat/completions",
                headers={"Authorization": f"Bearer {OPENROUTER_API_KEY}", "Content-Type": "application/json"},
                json={"model": "google/gemini-2.5-flash", "messages": [{"role": "user", "content": prompt}], "temperature": 0},
            )
        resp_data = r.json()
        if r.status_code != 200 or "choices" not in resp_data:
            err = resp_data.get("error", {})
            msg = err.get("message", str(resp_data)) if isinstance(err, dict) else str(err)
            raise ValueError(f"OpenRouter error ({r.status_code}): {msg}")
        raw = resp_data["choices"][0]["message"]["content"].strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        return json.loads(raw.strip())
    except Exception as e:
        raise HTTPException(422, f"LLM parsing failed: {e}")


async def llm_parse_statement(text: str) -> dict:
    prompt = (
        "You are a financial data extraction assistant for bank statements.\n"
        "Analyze this bank statement text and return ONLY a single valid JSON object — "
        "no markdown fences, no explanation.\n\n"
        "The object must use this exact schema:\n"
        "{\n"
        '  "bank_name": "<bank name as printed, e.g. Barclays, HSBC, Monzo, Lloyds, NatWest, Revolut, Chase, M-Pesa, Equity Bank, KCB>",\n'
        '  "account_number": "<the primary account number, IBAN, or phone number — digits and hyphens only, no spaces>",\n'
        '  "currency": "<ISO code, e.g. GBP, USD, KES>",\n'
        '  "closing_balance": <the final closing balance as a signed number — negative for overdrafts/credit card debt, positive for assets. null if not found>,\n'
        '  "transactions": [\n'
        "    {\n"
        '      "ref": "<receipt / reference / cheque number, or null if absent>",\n'
        '      "date": "<ISO 8601 datetime, e.g. 2024-03-15T14:30:00>",\n'
        '      "type": "<credit or debit>",\n'
        '      "amount": <positive number>,\n'
        '      "description": "<full narration>",\n'
        '      "balance": <running balance after transaction as signed number, or null>\n'
        "    }\n"
        "  ]\n"
        "}\n\n"
        "Rules:\n"
        "- credit = money received / deposited into the account\n"
        "- debit = money sent / withdrawn / paid out\n"
        "- closing_balance is signed: -463.45 means the account is overdrawn by £463.45\n"
        "- If ref is absent or unclear, set it to null (NOT a generated string)\n"
        "- Ignore header rows, footers, totals, and non-transaction lines\n"
        "- Do NOT include closing/opening balance summary rows as transactions\n"
        "- Extract ALL real transactions in the statement\n\n"
        "STATEMENT TEXT:\n" + text[:14000]
    )
    try:
        async with httpx.AsyncClient(timeout=90) as client:
            r = await client.post(
                "https://openrouter.ai/api/v1/chat/completions",
                headers={"Authorization": f"Bearer {OPENROUTER_API_KEY}", "Content-Type": "application/json"},
                json={"model": "google/gemini-2.5-flash", "messages": [{"role": "user", "content": prompt}], "temperature": 0},
            )
        resp_data = r.json()
        if r.status_code != 200 or "choices" not in resp_data:
            err = resp_data.get("error", {})
            msg = err.get("message", str(resp_data)) if isinstance(err, dict) else str(err)
            raise ValueError(f"OpenRouter error ({r.status_code}): {msg}")
        raw = resp_data["choices"][0]["message"]["content"].strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        parsed = json.loads(raw.strip())
        if not isinstance(parsed, dict) or "transactions" not in parsed:
            raise ValueError("LLM response missing required keys")
        return parsed
    except Exception as e:
        raise HTTPException(422, f"LLM parsing failed: {e}")


async def llm_parse_investment_statement(text: str) -> dict:
    prompt = (
        "You are a financial data extraction assistant. Below is raw text from an investment account statement "
        "(e.g. Vanguard ISA, Wealthify, Hargreaves Lansdown, Fidelity, AJ Bell, etc.).\n"
        "Return ONLY a single valid JSON object — no markdown fences, no explanation.\n\n"
        "Required schema:\n"
        "{\n"
        '  "provider": "<e.g. Vanguard, Wealthify, Hargreaves Lansdown>",\n'
        '  "account_type": "<e.g. ISA, GIA, SIPP, Pension, Stocks and Shares ISA>",\n'
        '  "account_reference": "<the plan/account reference number>",\n'
        '  "statement_date": "<ISO date of statement end date, e.g. 2026-06-04>",\n'
        '  "currency": "<ISO code, e.g. GBP>",\n'
        '  "total_value": <total portfolio value as a number>,\n'
        '  "holdings": [\n'
        "    {\n"
        '      "name": "<full fund/ETF/stock name>",\n'
        '      "isin": "<ISIN code if present, else null>",\n'
        '      "type": "<Fund, ETF, Share, Bond, Infrastructure, Property, Cash>",\n'
        '      "units": <units/shares held as number, or null>,\n'
        '      "price_per_unit": <price per unit in statement currency, or null>,\n'
        '      "value": <total value of this holding as a number>\n'
        "    }\n"
        "  ]\n"
        "}\n\n"
        "Rules:\n"
        "- Include cash holdings if they have a non-zero value.\n"
        "- total_value should be the closing portfolio value shown in the statement.\n"
        "- If units or price_per_unit are not present, set them to null.\n"
        "- Extract ALL holdings shown in the statement.\n\n"
        "STATEMENT TEXT:\n" + text[:15000]
    )
    try:
        async with httpx.AsyncClient(timeout=90) as client:
            r = await client.post(
                "https://openrouter.ai/api/v1/chat/completions",
                headers={"Authorization": f"Bearer {OPENROUTER_API_KEY}", "Content-Type": "application/json"},
                json={"model": "google/gemini-2.5-flash", "messages": [{"role": "user", "content": prompt}], "temperature": 0},
            )
        resp_data = r.json()
        if r.status_code != 200 or "choices" not in resp_data:
            err = resp_data.get("error", {})
            msg = err.get("message", str(resp_data)) if isinstance(err, dict) else str(err)
            raise ValueError(f"OpenRouter error ({r.status_code}): {msg}")
        raw = resp_data["choices"][0]["message"]["content"].strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        parsed = json.loads(raw.strip())
        if not isinstance(parsed, dict) or "holdings" not in parsed:
            raise ValueError("LLM response missing required keys")
        return parsed
    except Exception as e:
        raise HTTPException(422, f"LLM investment parsing failed: {e}")
