"""
AI Wealth Discord Bot
Spending notifications, pay-period tracking, and AI-powered guidance.
"""

import calendar
import discord
from discord import app_commands
from discord.ext import tasks
import httpx
import os
import json
import io
from datetime import datetime, timedelta, date
from pathlib import Path
from dotenv import load_dotenv
from collections import defaultdict

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

load_dotenv()

DISCORD_BOT_TOKEN = os.getenv("DISCORD_BOT_TOKEN", "")
DISCORD_CHANNEL_ID = int(os.getenv("DISCORD_CHANNEL_ID", "0"))
BOT_SECRET = os.getenv("BOT_SECRET", "")
BACKEND_URL = os.getenv("BACKEND_URL", "http://localhost:8000")
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "")

STATE_FILE = Path(__file__).parent / "bot_state.json"

CATEGORIES = [
    "Groceries", "Eating Out", "Transport", "Entertainment",
    "Shopping", "Bills", "Subscriptions", "Health", "Travel",
    "Software", "Savings", "Transfer", "Income", "Other",
]

CATEGORY_COLOURS = {
    "Groceries": "#4CAF50", "Eating Out": "#FF9800", "Transport": "#2196F3",
    "Entertainment": "#9C27B0", "Shopping": "#E91E63", "Bills": "#F44336",
    "Subscriptions": "#FF5722", "Health": "#00BCD4", "Travel": "#3F51B5",
    "Software": "#607D8B", "Savings": "#8BC34A", "Transfer": "#9E9E9E",
    "Income": "#26C6DA", "Other": "#795548",
}

# ─── State ────────────────────────────────────────────────────────────────────

def load_state() -> dict:
    if STATE_FILE.exists():
        try:
            return json.loads(STATE_FILE.read_text())
        except Exception:
            pass
    return {"seen_transactions": [], "budgets": {}, "payday_overrides": {}, "custom_categories": {}}

def save_state(state: dict):
    STATE_FILE.write_text(json.dumps(state, indent=2, default=str))

# ─── Pay period ───────────────────────────────────────────────────────────────

def last_friday(year: int, month: int) -> date:
    last_day = calendar.monthrange(year, month)[1]
    for d in range(last_day, last_day - 7, -1):
        if date(year, month, d).weekday() == 4:
            return date(year, month, d)

def get_payday(year: int, month: int, overrides: dict) -> date:
    key = f"{year}-{month:02d}"
    if key in overrides:
        return date.fromisoformat(overrides[key])
    return last_friday(year, month)

def get_pay_period_for(ref: date, state: dict) -> tuple[date, date]:
    """Return the pay period that contains `ref`."""
    overrides = state.get("payday_overrides", {})
    this_pay  = get_payday(ref.year, ref.month, overrides)
    if ref >= this_pay:
        start = this_pay
        nm    = ref.month % 12 + 1
        ny    = ref.year + (1 if ref.month == 12 else 0)
        end   = get_payday(ny, nm, overrides)
    else:
        end   = this_pay
        pm    = (ref.month - 2) % 12 + 1
        py    = ref.year - (1 if ref.month == 1 else 0)
        start = get_payday(py, pm, overrides)
    return start, end

def get_pay_period(state: dict) -> tuple[date, date]:
    return get_pay_period_for(date.today(), state)

def prev_period(start: date, state: dict) -> tuple[date, date]:
    return get_pay_period_for(start - timedelta(days=1), state)

def next_period(end: date, state: dict) -> tuple[date, date]:
    return get_pay_period_for(end, state)

# ─── API ──────────────────────────────────────────────────────────────────────

def _headers():
    return {"Authorization": f"Bearer {BOT_SECRET}"}

async def api_get(path: str):
    try:
        async with httpx.AsyncClient(timeout=10) as c:
            r = await c.get(f"{BACKEND_URL}{path}", headers=_headers())
            if r.status_code == 200:
                return r.json()
    except Exception:
        pass
    return None

async def fetch_all_transactions(accounts: list) -> list:
    all_txns = []
    for acc in accounts:
        txns = await api_get(f"/accounts/{acc['id']}/transactions")
        if txns:
            for t in txns:
                t["_account_name"] = acc["name"]
                t["_account_id"] = acc["id"]
            all_txns.extend(txns)
    return all_txns

def filter_period(transactions: list, start: date, end: date, custom_categories: dict = None) -> list:
    result = []
    for t in transactions:
        d = datetime.fromisoformat(t["date"].replace("Z", "")).date()
        if start <= d < end:
            t = dict(t)
            # custom_category from MongoDB takes priority, then bot_state fallback
            if not t.get("custom_category") and custom_categories and t.get("id") in custom_categories:
                t["custom_category"] = custom_categories[t["id"]]
            # resolve effective category for display
            t["_category"] = t.get("custom_category") or t.get("category") or "Other"
            result.append(t)
    return result

# ─── Embeds ───────────────────────────────────────────────────────────────────

def make_category_embed(txns: list, start: date, end: date, title: str = "Spend") -> discord.Embed:
    income   = [t for t in txns if t.get("transaction_type") == "credit"]
    expenses = [t for t in txns if t.get("transaction_type") == "debit"]
    total_in  = sum(t["amount"] for t in income)
    total_out = sum(t["amount"] for t in expenses)
    net = total_in - total_out

    by_cat: dict[str, float] = defaultdict(float)
    for t in expenses:
        by_cat[t.get("_category", "Other")] += t["amount"]

    embed = discord.Embed(
        title=f"{title} — {start.strftime('%d %b')} → {end.strftime('%d %b')}",
        colour=0xe74c3c if net < 0 else 0x2ecc71,
        timestamp=datetime.now(),
    )
    embed.add_field(name="Income", value=f"£{total_in:,.2f}", inline=True)
    embed.add_field(name="Spent",  value=f"£{total_out:,.2f}", inline=True)
    embed.add_field(name="Net",    value=f"£{net:+,.2f}", inline=True)

    if by_cat:
        lines = "\n".join(
            f"{cat:<18} £{amt:>8,.2f}"
            for cat, amt in sorted(by_cat.items(), key=lambda x: -x[1])
        )
        embed.add_field(name="By Category", value=f"```{lines}```", inline=False)
        embed.set_footer(text="Select a category below to drill in  •  use ◀ ▶ to navigate periods")
    else:
        embed.set_footer(text="No expense transactions in this period")
    return embed

def embed_by_account(txns: list, start: date, end: date) -> discord.Embed:
    by_acc: dict[str, dict] = defaultdict(lambda: {"in": 0.0, "out": 0.0})
    for t in txns:
        name = t.get("_account_name", "Unknown")
        if t["transaction_type"] == "credit":
            by_acc[name]["in"] += t["amount"]
        else:
            by_acc[name]["out"] += t["amount"]

    embed = discord.Embed(
        title=f"Spend — {start.strftime('%d %b')} → {end.strftime('%d %b')}",
        colour=0x5865f2,
        timestamp=datetime.now(),
    )
    for name, totals in by_acc.items():
        net = totals["in"] - totals["out"]
        embed.add_field(
            name=name,
            value=f"In: £{totals['in']:,.2f}  Out: £{totals['out']:,.2f}  Net: £{net:+,.2f}",
            inline=False,
        )
    embed.set_footer(text="By Account  •  use ◀ ▶ to navigate periods")
    return embed

PAGE_SIZE = 20

class AccountDetailView(discord.ui.View):
    def __init__(self, account: dict, txns: list, start: date, end: date,
                 parent_accounts: list, parent_all_txns: list, state: dict,
                 page: int = 0, mode: str = "transactions"):
        super().__init__(timeout=300)
        self.account         = account
        self.txns            = txns          # sorted desc, already filtered to this account+period
        self.start           = start
        self.end             = end
        self.parent_accounts = parent_accounts
        self.parent_all_txns = parent_all_txns
        self.state           = state
        self.page            = page
        self.mode            = mode          # "transactions" | "categories"
        self._rebuild()

    def _total_pages(self) -> int:
        return max(1, (len(self.txns) + PAGE_SIZE - 1) // PAGE_SIZE)

    def _page_txns(self) -> list:
        s = self.page * PAGE_SIZE
        return self.txns[s:s + PAGE_SIZE]

    def make_embed(self) -> discord.Embed:
        if self.mode == "categories":
            return make_category_embed(self.txns, self.start, self.end, self.account["name"])

        page_txns = self._page_txns()
        total     = self._total_pages()
        bal       = self.account.get("balance", 0)
        bal_str   = f"-£{abs(bal):,.2f}" if bal < 0 else f"£{bal:,.2f}"
        embed = discord.Embed(
            title=f"{self.account['name']}  •  {bal_str}",
            colour=0x5865f2, timestamp=datetime.now(),
        )
        if not page_txns:
            embed.description = "No transactions in this pay period."
        else:
            lines = []
            for t in page_txns:
                d        = datetime.fromisoformat(t["date"].replace("Z", "")).strftime("%d %b")
                merchant = (t.get("merchant_name") or t.get("description", "?"))[:20]
                sign     = "-" if t.get("transaction_type") == "debit" else "+"
                cat      = (t.get("_category") or "?")[:14]
                lines.append(f"{d}  {merchant:<20}  {sign}£{t['amount']:>8,.2f}  {cat}")
            embed.description = (
                f"```\n{'Date':<6}  {'Merchant':<20}  {'Amount':>10}  Category\n"
                f"{'─'*58}\n" + "\n".join(lines) + "```"
            )
        embed.set_footer(
            text=f"Page {self.page+1}/{total}  •  {len(self.txns)} transactions  •  {self.start:%d %b} → {self.end:%d %b}"
        )
        return embed

    def _rebuild(self):
        self.clear_items()

        # Row 0: ← Accounts | [pagination or spacer] | 📊/📋 toggle
        back = discord.ui.Button(label="← Accounts", style=discord.ButtonStyle.secondary, row=0)
        back.callback = self._back
        self.add_item(back)

        if self.mode == "transactions":
            total = self._total_pages()
            prev_btn = discord.ui.Button(label="◀", style=discord.ButtonStyle.secondary, row=0,
                                         disabled=self.page == 0)
            prev_btn.callback = self._prev
            self.add_item(prev_btn)

            self.add_item(discord.ui.Button(label=f"{self.page+1}/{total}",
                                            style=discord.ButtonStyle.secondary, row=0, disabled=True))

            nxt_btn = discord.ui.Button(label="▶", style=discord.ButtonStyle.secondary, row=0,
                                        disabled=self.page >= total - 1)
            nxt_btn.callback = self._next
            self.add_item(nxt_btn)

        toggle = discord.ui.Button(
            label="📊 Categories" if self.mode == "transactions" else "📋 Transactions",
            style=discord.ButtonStyle.secondary, row=0,
        )
        toggle.callback = self._toggle_mode
        self.add_item(toggle)

        if self.mode == "transactions":
            # Row 1: transaction select
            page_txns = self._page_txns()
            if page_txns:
                opts = []
                for t in page_txns:
                    label = (t.get("merchant_name") or t.get("description", "?"))[:40]
                    cat   = t.get("_category") or "Uncategorised"
                    d_str = datetime.fromisoformat(t["date"].replace("Z", "")).strftime("%d %b")
                    sign  = "-" if t.get("transaction_type") == "debit" else "+"
                    opts.append(discord.SelectOption(
                        label=label, value=t["id"],
                        description=f"{sign}£{t['amount']:.2f}  {d_str}  [{cat}]",
                    ))
                txn_sel = discord.ui.Select(placeholder="Select a transaction to view details...", options=opts, row=1)
                txn_sel.callback = self._select_txn
                self.add_item(txn_sel)
        else:
            # Row 1: category drill-down select
            by_cat: dict[str, float] = defaultdict(float)
            for t in self.txns:
                if t.get("transaction_type") == "debit":
                    by_cat[t.get("_category", "Other")] += t["amount"]
            cat_amounts = sorted(by_cat.items(), key=lambda x: -x[1])
            if cat_amounts:
                opts = [
                    discord.SelectOption(label=cat, value=cat, description=f"£{amt:,.2f}")
                    for cat, amt in cat_amounts[:25]
                ]
                sel = discord.ui.Select(placeholder="Drill into a category...", options=opts, row=1)
                sel.callback = self._drill_category
                self.add_item(sel)

    async def _toggle_mode(self, interaction: discord.Interaction):
        self.mode = "categories" if self.mode == "transactions" else "transactions"
        self._rebuild()
        await interaction.response.edit_message(embed=self.make_embed(), view=self)

    async def _drill_category(self, interaction: discord.Interaction):
        category = interaction.data["values"][0]
        cat_txns = sorted(
            [t for t in self.txns if t.get("_category") == category],
            key=lambda x: x["date"], reverse=True,
        )
        drill = CategoryDrillView(category, cat_txns, self.start, self.end, self)
        await interaction.response.edit_message(embed=drill.make_embed(), view=drill)

    async def _prev(self, interaction: discord.Interaction):
        self.page = max(0, self.page - 1)
        self._rebuild()
        await interaction.response.edit_message(embed=self.make_embed(), view=self)

    async def _next(self, interaction: discord.Interaction):
        self.page = min(self._total_pages() - 1, self.page + 1)
        self._rebuild()
        await interaction.response.edit_message(embed=self.make_embed(), view=self)

    async def _select_txn(self, interaction: discord.Interaction):
        txn_id = interaction.data["values"][0]
        txn = next((t for t in self.txns if t["id"] == txn_id), None)
        if not txn:
            await interaction.response.defer()
            return
        detail_view = TransactionDetailView(txn, self)
        await interaction.response.edit_message(embed=detail_view.make_embed(), view=detail_view)

    async def _back(self, interaction: discord.Interaction):
        period_txns = filter_period(self.parent_all_txns, self.start, self.end)
        view  = AccountView(self.parent_accounts, period_txns, self.start, self.end, self.state)
        embed = discord.Embed(
            title="Accounts",
            description=f"Pay period: **{self.start:%d %b} → {self.end:%d %b}**\nSelect an account below.",
            colour=0x5865f2, timestamp=datetime.now(),
        )
        await interaction.response.edit_message(embed=embed, view=view)


class TransactionDetailView(discord.ui.View):
    def __init__(self, txn: dict, parent: "AccountDetailView"):
        super().__init__(timeout=300)
        self.txn    = txn
        self.parent = parent

        cat_opts = [
            discord.SelectOption(
                label=c, value=c,
                default=(c == (txn.get("custom_category") or txn.get("category"))),
            )
            for c in CATEGORIES
        ]
        cat_sel = discord.ui.Select(placeholder="Change category...", options=cat_opts, row=1)
        cat_sel.callback = self._select_cat
        self.add_item(cat_sel)

    def make_embed(self) -> discord.Embed:
        t       = self.txn
        d       = datetime.fromisoformat(t["date"].replace("Z", ""))
        is_debit = t.get("transaction_type") == "debit"
        sign    = "-" if is_debit else "+"
        colour  = 0xe74c3c if is_debit else 0x2ecc71
        merchant = t.get("merchant_name") or t.get("description", "Unknown")

        embed = discord.Embed(
            title=merchant,
            colour=colour,
            timestamp=d,
        )
        embed.add_field(name="Amount",   value=f"{sign}£{t['amount']:,.2f}", inline=True)
        embed.add_field(name="Date",     value=d.strftime("%d %b %Y"), inline=True)
        embed.add_field(name="Type",     value="Debit" if is_debit else "Credit", inline=True)

        cat = t.get("custom_category") or t.get("category") or "Other"
        cat_label = f"{cat} *(custom)*" if t.get("custom_category") else cat
        embed.add_field(name="Category", value=cat_label, inline=True)

        if t.get("description") and t.get("merchant_name"):
            embed.add_field(name="Description", value=t["description"], inline=False)
        if t.get("currency") and t["currency"] != "GBP":
            embed.add_field(name="Currency", value=t["currency"], inline=True)

        embed.set_footer(text=f"ID: {t['id']}")
        return embed

    @discord.ui.button(label="← Back", style=discord.ButtonStyle.secondary, row=0)
    async def go_back(self, interaction: discord.Interaction, button: discord.ui.Button):
        await interaction.response.edit_message(
            embed=self.parent.make_embed(), view=self.parent,
        )

    async def _select_cat(self, interaction: discord.Interaction):
        category = interaction.data["values"][0]
        async with httpx.AsyncClient(timeout=10) as http:
            await http.patch(
                f"{BACKEND_URL}/transactions/{self.txn['id']}",
                headers={"Authorization": f"Bearer {BOT_SECRET}"},
                json={"category": category},
            )
        self.txn["custom_category"] = category
        self.txn["_category"]       = category
        # also update in parent's txn list so the list view reflects the change
        for t in self.parent.txns:
            if t["id"] == self.txn["id"]:
                t["custom_category"] = category
                t["_category"]       = category
        embed = self.make_embed()
        embed.set_footer(text=f"✅ Category saved: {category}")
        await interaction.response.edit_message(embed=embed, view=self)

class CategoryDrillView(discord.ui.View):
    """Paginated list of transactions for a single budgetary category."""

    def __init__(self, category: str, cat_txns: list, start: date, end: date,
                 parent: discord.ui.View, page: int = 0):
        super().__init__(timeout=300)
        self.category = category
        self.txns     = cat_txns  # sorted desc, already filtered to this category+period
        self.start    = start
        self.end      = end
        self.parent   = parent
        self.page     = page
        self._rebuild()

    def _total_pages(self) -> int:
        return max(1, (len(self.txns) + PAGE_SIZE - 1) // PAGE_SIZE)

    def _page_txns(self) -> list:
        s = self.page * PAGE_SIZE
        return self.txns[s:s + PAGE_SIZE]

    def make_embed(self) -> discord.Embed:
        page_txns = self._page_txns()
        total_amt = sum(t["amount"] for t in self.txns if t.get("transaction_type") == "debit")
        colour    = int(CATEGORY_COLOURS.get(self.category, "#5865f2").lstrip("#"), 16)
        embed = discord.Embed(
            title=f"{self.category}  •  £{total_amt:,.2f}",
            colour=colour,
            timestamp=datetime.now(),
        )
        if not page_txns:
            embed.description = "No transactions in this category."
        else:
            lines = []
            for t in page_txns:
                d        = datetime.fromisoformat(t["date"].replace("Z", "")).strftime("%d %b")
                merchant = (t.get("merchant_name") or t.get("description", "?"))[:22]
                sign     = "-" if t.get("transaction_type") == "debit" else "+"
                acc      = t.get("_account_name", "")[:12]
                lines.append(f"{d}  {merchant:<22}  {sign}£{t['amount']:>8,.2f}  {acc}")
            embed.description = (
                f"```\n{'Date':<6}  {'Merchant':<22}  {'Amount':>10}  Account\n"
                f"{'─'*55}\n" + "\n".join(lines) + "```"
            )
        embed.set_footer(
            text=f"Page {self.page+1}/{self._total_pages()}  •  {len(self.txns)} transactions  •  {self.start:%d %b} → {self.end:%d %b}"
        )
        return embed

    def _rebuild(self):
        self.clear_items()
        total     = self._total_pages()
        page_txns = self._page_txns()

        back = discord.ui.Button(label="← Back", style=discord.ButtonStyle.secondary, row=0)
        back.callback = self._back
        self.add_item(back)

        prev_btn = discord.ui.Button(label="◀", style=discord.ButtonStyle.secondary, row=0,
                                     disabled=self.page == 0)
        prev_btn.callback = self._prev
        self.add_item(prev_btn)

        self.add_item(discord.ui.Button(label=f"{self.page+1}/{total}",
                                        style=discord.ButtonStyle.secondary, row=0, disabled=True))

        next_btn = discord.ui.Button(label="▶", style=discord.ButtonStyle.secondary, row=0,
                                     disabled=self.page >= total - 1)
        next_btn.callback = self._next
        self.add_item(next_btn)

        if page_txns:
            opts = []
            for t in page_txns:
                label = (t.get("merchant_name") or t.get("description", "?"))[:40]
                d_str = datetime.fromisoformat(t["date"].replace("Z", "")).strftime("%d %b")
                sign  = "-" if t.get("transaction_type") == "debit" else "+"
                opts.append(discord.SelectOption(
                    label=label, value=t["id"],
                    description=f"{sign}£{t['amount']:.2f}  {d_str}",
                ))
            sel = discord.ui.Select(placeholder="Select a transaction for details...", options=opts, row=1)
            sel.callback = self._select_txn
            self.add_item(sel)

    async def _back(self, interaction: discord.Interaction):
        await interaction.response.edit_message(embed=self.parent.make_embed(), view=self.parent)

    async def _prev(self, interaction: discord.Interaction):
        self.page = max(0, self.page - 1)
        self._rebuild()
        await interaction.response.edit_message(embed=self.make_embed(), view=self)

    async def _next(self, interaction: discord.Interaction):
        self.page = min(self._total_pages() - 1, self.page + 1)
        self._rebuild()
        await interaction.response.edit_message(embed=self.make_embed(), view=self)

    async def _select_txn(self, interaction: discord.Interaction):
        txn_id = interaction.data["values"][0]
        txn = next((t for t in self.txns if t["id"] == txn_id), None)
        if not txn:
            await interaction.response.defer()
            return
        detail_view = TransactionDetailView(txn, self)
        await interaction.response.edit_message(embed=detail_view.make_embed(), view=detail_view)


# ─── Views ────────────────────────────────────────────────────────────────────

class SpendView(discord.ui.View):
    def __init__(self, txns: list, start: date, end: date, state: dict, view_type: str = "category"):
        super().__init__(timeout=180)
        self.txns      = txns
        self.start     = start
        self.end       = end
        self.state     = state
        self.view_type = view_type  # "category" | "account"
        self._rebuild()

    def make_embed(self) -> discord.Embed:
        if self.view_type == "account":
            return embed_by_account(self.txns, self.start, self.end)
        return make_category_embed(self.txns, self.start, self.end)

    def _cat_amounts(self) -> list:
        by_cat: dict[str, float] = defaultdict(float)
        for t in self.txns:
            if t.get("transaction_type") == "debit":
                by_cat[t.get("_category", "Other")] += t["amount"]
        return sorted(by_cat.items(), key=lambda x: -x[1])

    def _rebuild(self):
        self.clear_items()

        # Row 0: ◀  By Category  By Account  ▶
        prev_btn = discord.ui.Button(label="◀", style=discord.ButtonStyle.secondary, row=0)
        prev_btn.callback = self._go_prev
        self.add_item(prev_btn)

        cat_btn = discord.ui.Button(
            label="By Category",
            style=discord.ButtonStyle.primary if self.view_type == "category" else discord.ButtonStyle.secondary,
            row=0,
        )
        cat_btn.callback = self._by_category
        self.add_item(cat_btn)

        acc_btn = discord.ui.Button(
            label="By Account",
            style=discord.ButtonStyle.primary if self.view_type == "account" else discord.ButtonStyle.secondary,
            row=0,
        )
        acc_btn.callback = self._by_account
        self.add_item(acc_btn)

        next_btn = discord.ui.Button(label="▶", style=discord.ButtonStyle.secondary, row=0)
        next_btn.callback = self._go_next
        self.add_item(next_btn)

        # Row 1: category drill-down select (only in category view)
        if self.view_type == "category":
            cat_amounts = self._cat_amounts()
            if cat_amounts:
                opts = [
                    discord.SelectOption(label=cat, value=cat, description=f"£{amt:,.2f}")
                    for cat, amt in cat_amounts[:25]
                ]
                sel = discord.ui.Select(placeholder="Drill into a category...", options=opts, row=1)
                sel.callback = self._drill_category
                self.add_item(sel)

    async def _go_prev(self, interaction: discord.Interaction):
        s, e = prev_period(self.start, self.state)
        await self._navigate(interaction, s, e)

    async def _go_next(self, interaction: discord.Interaction):
        s, e = next_period(self.end, self.state)
        await self._navigate(interaction, s, e)

    async def _by_category(self, interaction: discord.Interaction):
        self.view_type = "category"
        self._rebuild()
        await interaction.response.edit_message(embed=self.make_embed(), view=self)

    async def _by_account(self, interaction: discord.Interaction):
        self.view_type = "account"
        self._rebuild()
        await interaction.response.edit_message(embed=self.make_embed(), view=self)

    async def _navigate(self, interaction: discord.Interaction, new_start: date, new_end: date):
        accounts = await api_get("/accounts")
        all_txns = await fetch_all_transactions(accounts or [])
        state = load_state()
        self.txns  = filter_period(all_txns, new_start, new_end, state.get("custom_categories", {}))
        self.start = new_start
        self.end   = new_end
        self._rebuild()
        await interaction.response.edit_message(embed=self.make_embed(), view=self)

    async def _drill_category(self, interaction: discord.Interaction):
        category = interaction.data["values"][0]
        cat_txns = sorted(
            [t for t in self.txns if t.get("_category") == category],
            key=lambda x: x["date"], reverse=True,
        )
        drill = CategoryDrillView(category, cat_txns, self.start, self.end, self)
        await interaction.response.edit_message(embed=drill.make_embed(), view=drill)


class AccountView(discord.ui.View):
    def __init__(self, accounts: list, all_txns: list, start: date, end: date, state: dict):
        super().__init__(timeout=180)
        self.accounts = accounts
        self.all_txns = all_txns
        self.start = start
        self.end = end
        self.state = state

        options = [
            discord.SelectOption(
                label=acc["name"][:25],
                value=acc["id"],
                description=f"£{acc['balance']:,.2f}",
            )
            for acc in accounts[:25]
        ]
        select = discord.ui.Select(placeholder="Choose an account to inspect...", options=options)
        select.callback = self._on_select
        self.add_item(select)

    async def _on_select(self, interaction: discord.Interaction):
        account_id = interaction.data["values"][0]
        account = next(a for a in self.accounts if a["id"] == account_id)
        acc_txns = sorted(
            [t for t in self.all_txns if t.get("_account_id") == account_id],
            key=lambda x: x["date"], reverse=True,
        )
        detail_view = AccountDetailView(
            account, acc_txns, self.start, self.end,
            self.accounts, self.all_txns, self.state,
        )
        await interaction.response.edit_message(embed=detail_view.make_embed(), view=detail_view)


class CategoriseView(discord.ui.View):
    def __init__(self, txns: list):
        super().__init__(timeout=180)
        self.txns         = txns
        self.selected_txn = None
        self.selected_name = None

        recent = sorted(txns, key=lambda x: x["date"], reverse=True)[:25]
        txn_options = []
        for t in recent:
            label = (t.get("merchant_name") or t.get("description", "Unknown"))[:40]
            cat   = t.get("_category") or t.get("custom_category") or t.get("category") or "Uncategorised"
            d_str = datetime.fromisoformat(t["date"].replace("Z", "")).strftime("%d %b")
            txn_options.append(discord.SelectOption(
                label=label,
                value=t["id"],
                description=f"£{t['amount']:.2f}  {d_str}  [{cat}]",
            ))

        cat_options = [discord.SelectOption(label=c, value=c) for c in CATEGORIES]

        txn_select = discord.ui.Select(placeholder="1. Pick a transaction...", options=txn_options, row=0)
        txn_select.callback = self._pick_txn
        self.add_item(txn_select)

        cat_select = discord.ui.Select(placeholder="2. Assign a category...", options=cat_options, row=1)
        cat_select.callback = self._pick_cat
        self.add_item(cat_select)

    async def _pick_txn(self, interaction: discord.Interaction):
        self.selected_txn = interaction.data["values"][0]
        txn = next((t for t in self.txns if t["id"] == self.selected_txn), None)
        self.selected_name = (txn.get("merchant_name") or txn.get("description", "?")) if txn else "?"
        await interaction.response.defer()

    async def _pick_cat(self, interaction: discord.Interaction):
        if not self.selected_txn:
            await interaction.response.send_message("Pick a transaction first (step 1).", ephemeral=True)
            return
        category = interaction.data["values"][0]
        # Save to MongoDB via API
        async with httpx.AsyncClient(timeout=10) as http:
            await http.patch(
                f"{BACKEND_URL}/transactions/{self.selected_txn}",
                headers={"Authorization": f"Bearer {BOT_SECRET}"},
                json={"category": category},
            )
        await interaction.response.edit_message(
            content=f"✅ **{self.selected_name}** → **{category}**",
            embed=None, view=None,
        )

# ─── Background polling ───────────────────────────────────────────────────────

@tasks.loop(minutes=5)
async def poll_transactions():
    channel = client.get_channel(DISCORD_CHANNEL_ID)
    if not channel:
        return
    accounts = await api_get("/accounts")
    if not accounts:
        return
    state = load_state()
    seen = set(state.get("seen_transactions", []))
    for acc in accounts:
        txns = await api_get(f"/accounts/{acc['id']}/transactions")
        if not txns:
            continue
        for t in txns:
            if t["id"] in seen:
                continue
            seen.add(t["id"])
            d = datetime.fromisoformat(t["date"].replace("Z", ""))
            if datetime.now() - d < timedelta(hours=24):
                sign = "-" if t["transaction_type"] == "debit" else "+"
                merchant = t.get("merchant_name") or t.get("description", "Unknown")
                embed = discord.Embed(
                    title=f"{'💳' if t['transaction_type'] == 'debit' else '💰'} {merchant}",
                    colour=0xe74c3c if t["transaction_type"] == "debit" else 0x2ecc71,
                    timestamp=d,
                )
                embed.add_field(name="Amount", value=f"{sign}£{t['amount']:.2f}", inline=True)
                embed.add_field(name="Account", value=acc["name"], inline=True)
                embed.add_field(name="Category", value=t.get("category") or "Other", inline=True)
                await channel.send(embed=embed)
    state["seen_transactions"] = list(seen)
    save_state(state)

@poll_transactions.before_loop
async def before_poll():
    await client.wait_until_ready()


@tasks.loop(hours=4)
async def periodic_sync():
    """Re-sync all users' bank connections every 4 hours."""
    try:
        async with httpx.AsyncClient(timeout=120) as http:
            r = await http.post(
                f"{BACKEND_URL}/admin/sync-all",
                headers={"Authorization": f"Bearer {BOT_SECRET}"},
            )
            if r.status_code == 200:
                data = r.json()
                print(f"[sync] {data.get('users', 0)} users, {data.get('connections', 0)} connections, {data.get('total_accounts', 0)} accounts synced")
            else:
                print(f"[sync] sync-all returned {r.status_code}: {r.text[:200]}")
    except Exception as e:
        print(f"[sync] periodic sync failed: {e}")

@periodic_sync.before_loop
async def before_sync():
    await client.wait_until_ready()

# ─── Bot setup ────────────────────────────────────────────────────────────────

intents = discord.Intents.default()
client = discord.Client(intents=intents)
tree = app_commands.CommandTree(client)

# ─── Commands ─────────────────────────────────────────────────────────────────

@tree.command(name="summary", description="Total balance across all accounts")
async def cmd_summary(interaction: discord.Interaction):
    await interaction.response.defer(ephemeral=True)
    accounts = await api_get("/accounts")
    if not accounts:
        await interaction.followup.send("No accounts connected. Use `/connect` first.", ephemeral=True)
        return

    bank_accounts = [a for a in accounts if a.get("type") != "credit_card"]
    credit_cards  = [a for a in accounts if a.get("type") == "credit_card"]

    total_cash = sum(a["balance"] for a in bank_accounts)
    total_debt = sum(a["balance"] for a in credit_cards)  # already negative
    net        = total_cash + total_debt                   # debt subtracts automatically

    embed = discord.Embed(title="Wealth Summary", colour=0x5865f2, timestamp=datetime.now())
    embed.add_field(name="Net Worth",   value=f"£{net:,.2f}",             inline=True)
    embed.add_field(name="Cash",        value=f"£{total_cash:,.2f}",      inline=True)
    embed.add_field(name="Credit Debt", value=f"-£{abs(total_debt):,.2f}", inline=True)

    if bank_accounts:
        lines = "\n".join(f"`{a['name'][:28]:<28}` £{a['balance']:>10,.2f}" for a in bank_accounts)
        embed.add_field(name="Bank Accounts", value=f"```{lines}```", inline=False)
    if credit_cards:
        lines = "\n".join(f"`{a['name'][:28]:<28}` -£{abs(a['balance']):>9,.2f}" for a in credit_cards)
        embed.add_field(name="Credit Cards", value=f"```{lines}```", inline=False)

    embed.set_footer(text="Use /accounts to inspect a specific account")
    await interaction.followup.send(embed=embed, ephemeral=True)


@tree.command(name="accounts", description="Browse accounts and see transactions per account")
async def cmd_accounts(interaction: discord.Interaction):
    await interaction.response.defer(ephemeral=True)
    accounts = await api_get("/accounts")
    if not accounts:
        await interaction.followup.send("No accounts connected. Use `/connect` first.", ephemeral=True)
        return

    state = load_state()
    start, end = get_pay_period(state)
    all_txns = await fetch_all_transactions(accounts)
    custom_cats = state.get("custom_categories", {})
    period_txns = filter_period(all_txns, start, end, custom_cats)

    embed = discord.Embed(
        title="Accounts",
        description=f"Pay period: **{start.strftime('%d %b')} → {end.strftime('%d %b')}**\nSelect an account below to see its transactions.",
        colour=0x5865f2,
        timestamp=datetime.now(),
    )
    view = AccountView(accounts, period_txns, start, end, state)
    await interaction.followup.send(embed=embed, view=view, ephemeral=True)


@tree.command(name="spend", description="Pay period spending breakdown")
async def cmd_spend(interaction: discord.Interaction):
    await interaction.response.defer(ephemeral=True)
    accounts = await api_get("/accounts")
    if not accounts:
        await interaction.followup.send("No accounts connected. Use `/connect` first.", ephemeral=True)
        return

    state = load_state()
    start, end = get_pay_period(state)
    all_txns = await fetch_all_transactions(accounts)
    period_txns = filter_period(all_txns, start, end, state.get("custom_categories", {}))

    embed = make_category_embed(period_txns, start, end)
    view = SpendView(period_txns, start, end, state)
    await interaction.followup.send(embed=embed, view=view, ephemeral=True)


@tree.command(name="categorise", description="Assign a category to a transaction this pay period")
async def cmd_categorise(interaction: discord.Interaction):
    await interaction.response.defer(ephemeral=True)
    accounts = await api_get("/accounts")
    if not accounts:
        await interaction.followup.send("No accounts connected. Use `/connect` first.", ephemeral=True)
        return

    state = load_state()
    start, end = get_pay_period(state)
    all_txns = await fetch_all_transactions(accounts)
    custom_cats = state.get("custom_categories", {})
    period_txns = filter_period(all_txns, start, end, custom_cats)

    debits = [t for t in period_txns if t["transaction_type"] == "debit"]
    if not debits:
        await interaction.followup.send("No expense transactions found in this pay period.", ephemeral=True)
        return

    view = CategoriseView(debits)
    await interaction.followup.send(
        "**Step 1:** pick a transaction  →  **Step 2:** assign a category",
        view=view, ephemeral=True,
    )


@tree.command(name="setpayday", description="Override the payday for a specific month (YYYY-MM-DD)")
@app_commands.describe(date_str="Date in YYYY-MM-DD format, e.g. 2026-05-30")
async def cmd_setpayday(interaction: discord.Interaction, date_str: str):
    try:
        d = date.fromisoformat(date_str)
    except ValueError:
        await interaction.response.send_message("Invalid date. Use format YYYY-MM-DD.", ephemeral=True)
        return
    key = f"{d.year}-{d.month:02d}"
    state = load_state()
    state.setdefault("payday_overrides", {})[key] = date_str
    save_state(state)
    await interaction.response.send_message(
        f"Payday for **{d.strftime('%B %Y')}** set to **{d.strftime('%d %b %Y')}**.", ephemeral=True
    )


@tree.command(name="budget", description="Budget vs actual for this pay period")
async def cmd_budget(interaction: discord.Interaction):
    await interaction.response.defer(ephemeral=True)
    state = load_state()
    budgets = state.get("budgets", {})
    if not budgets:
        await interaction.followup.send(
            "No budgets set. Use `/setbudget <category> <amount>` to add one.", ephemeral=True
        )
        return

    accounts = await api_get("/accounts")
    start, end = get_pay_period(state)
    all_txns = await fetch_all_transactions(accounts or [])
    custom_cats = state.get("custom_categories", {})
    period_txns = filter_period(all_txns, start, end, custom_cats)

    spent: dict[str, float] = defaultdict(float)
    for t in period_txns:
        if t["transaction_type"] == "debit":
            spent[t.get("category") or "Other"] += t["amount"]

    embed = discord.Embed(
        title=f"Budget — {start.strftime('%d %b')} → {end.strftime('%d %b')}",
        colour=0xf39c12, timestamp=datetime.now(),
    )
    for cat, limit in budgets.items():
        used = spent.get(cat, 0)
        pct = (used / limit * 100) if limit else 0
        bar_filled = int(pct / 10)
        bar = "█" * bar_filled + "░" * (10 - bar_filled)
        status = "🔴" if used >= limit else "🟡" if pct >= 80 else "🟢"
        embed.add_field(
            name=f"{status} {cat}",
            value=f"`{bar}` £{used:.0f} / £{limit:.0f} ({pct:.0f}%)",
            inline=False,
        )
    await interaction.followup.send(embed=embed, ephemeral=True)


@tree.command(name="setbudget", description="Set a monthly budget for a spending category")
@app_commands.describe(category="e.g. Groceries, Eating Out", amount="Budget limit in £")
async def cmd_setbudget(interaction: discord.Interaction, category: str, amount: float):
    state = load_state()
    state.setdefault("budgets", {})[category] = amount
    save_state(state)
    await interaction.response.send_message(f"Budget set: **{category}** → £{amount:.0f}", ephemeral=True)


@tree.command(name="insights", description="AI-generated insights from your transactions")
async def cmd_insights(interaction: discord.Interaction):
    await interaction.response.defer(ephemeral=True)
    insights = await api_get("/insights")
    if not insights:
        await interaction.followup.send("No insights yet — connect your bank with `/connect` first.", ephemeral=True)
        return
    embed = discord.Embed(title="Financial Insights", colour=0xf39c12, timestamp=datetime.now())
    for ins in insights[:5]:
        embed.add_field(
            name=f"{ins['title']} (+£{ins['impact']:.0f}/yr)",
            value=ins["rationale"] + f"\n**Action:** {ins['action']}",
            inline=False,
        )
    await interaction.followup.send(embed=embed, ephemeral=True)


@tree.command(name="ask", description="Ask your AI financial guide anything")
@app_commands.describe(question="What would you like to know?")
async def cmd_ask(interaction: discord.Interaction, question: str):
    await interaction.response.defer(ephemeral=True)
    if not OPENROUTER_API_KEY:
        await interaction.followup.send("Set `OPENROUTER_API_KEY` in `.env` to enable AI guidance.", ephemeral=True)
        return

    accounts = await api_get("/accounts")
    kpis = await api_get("/kpis")
    state = load_state()
    start, end = get_pay_period(state)
    all_txns = await fetch_all_transactions(accounts or [])
    period_txns = filter_period(all_txns, start, end, state.get("custom_categories", {}))

    ctx = []
    if kpis:
        ctx.append(f"Net worth: £{kpis['net_worth']:,.2f}, Cash: £{kpis['cash']:,.2f}, Runway: {kpis['runway']:.1f} months")
    if accounts:
        ctx.append("Accounts: " + ", ".join(f"{a['name']} £{a['balance']:,.2f}" for a in accounts))
    if period_txns:
        total_spent = sum(t["amount"] for t in period_txns if t["transaction_type"] == "debit")
        total_in = sum(t["amount"] for t in period_txns if t["transaction_type"] == "credit")
        ctx.append(f"Pay period ({start} to {end}): spent £{total_spent:,.2f}, received £{total_in:,.2f}")
        recent = sorted(period_txns, key=lambda x: x["date"], reverse=True)[:10]
        ctx.append("Recent: " + "; ".join(
            f"{t.get('merchant_name') or t['description']} £{t['amount']:.2f}" for t in recent
        ))

    system = (
        "You are a friendly, practical UK personal finance advisor. "
        "Answer concisely (under 300 words). Use £ not $. Be specific and actionable.\n"
        "User's financial context:\n" + "\n".join(ctx)
    )

    async with httpx.AsyncClient(timeout=30) as http:
        resp = await http.post(
            "https://openrouter.ai/api/v1/chat/completions",
            headers={"Authorization": f"Bearer {OPENROUTER_API_KEY}", "HTTP-Referer": "https://wealth.auriqltd.co.uk"},
            json={
                "model": "anthropic/claude-sonnet-4-5",
                "max_tokens": 400,
                "messages": [{"role": "system", "content": system}, {"role": "user", "content": question}],
            },
        )
        resp.raise_for_status()
        answer = resp.json()["choices"][0]["message"]["content"]

    embed = discord.Embed(title=f"Q: {question[:100]}", description=answer, colour=0x5865f2, timestamp=datetime.now())
    embed.set_footer(text="Powered by Claude via OpenRouter")
    await interaction.followup.send(embed=embed, ephemeral=True)


@tree.command(name="sync", description="Manually sync transactions from all connected banks")
async def cmd_sync(interaction: discord.Interaction):
    await interaction.response.defer(ephemeral=True)
    await interaction.followup.send("Syncing all bank connections...", ephemeral=True)
    try:
        async with httpx.AsyncClient(timeout=120) as http:
            sync_r = await http.post(
                f"{BACKEND_URL}/accounts/sync",
                headers={"Authorization": f"Bearer {BOT_SECRET}"},
            )
            if sync_r.status_code != 200:
                await interaction.followup.send(f"Sync failed (HTTP {sync_r.status_code}).", ephemeral=True)
                return

            cat_r = await http.post(
                f"{BACKEND_URL}/transactions/auto-categorise",
                headers={"Authorization": f"Bearer {BOT_SECRET}"},
            )

        data        = sync_r.json()
        connections = data.get("connections", 0)
        accounts    = data.get("total_accounts", 0)
        categorised = cat_r.json().get("categorised", 0) if cat_r.status_code == 200 else 0

        parts = [f"✅ Synced **{accounts}** account(s) across **{connections}** connection(s)."]
        if categorised:
            parts.append(f"AI categorised **{categorised}** new transaction(s).")
        await interaction.followup.send(" ".join(parts), ephemeral=True)
    except Exception as e:
        await interaction.followup.send(f"Error during sync: {e}", ephemeral=True)


@tree.command(name="recategorise", description="Re-run AI categorisation (default: today; optionally specify a date range)")
@app_commands.describe(
    from_date="Start date YYYY-MM-DD (default: today)",
    to_date="End date YYYY-MM-DD (default: no upper limit)",
)
async def cmd_recategorise(interaction: discord.Interaction,
                           from_date: str = None, to_date: str = None):
    # Validate any supplied dates
    for label, val in [("from_date", from_date), ("to_date", to_date)]:
        if val:
            try:
                date.fromisoformat(val)
            except ValueError:
                await interaction.response.send_message(
                    f"Invalid {label} — use YYYY-MM-DD format.", ephemeral=True
                )
                return

    await interaction.response.defer(ephemeral=True)
    range_desc = f"`{from_date or 'today'}` → `{to_date or 'now'}`"
    await interaction.followup.send(
        f"Running AI categorisation for {range_desc} — this may take a moment...", ephemeral=True
    )
    try:
        params = {}
        if from_date:
            params["from_date"] = from_date
        if to_date:
            params["to_date"] = to_date
        async with httpx.AsyncClient(timeout=120) as http:
            r = await http.post(
                f"{BACKEND_URL}/transactions/auto-categorise",
                headers={"Authorization": f"Bearer {BOT_SECRET}"},
                params=params,
            )
        if r.status_code == 200:
            n = r.json().get("categorised", 0)
            await interaction.followup.send(
                f"✅ Done — **{n}** transaction(s) categorised for {range_desc}.\nUse `/spend` or `/accounts` to review.",
                ephemeral=True,
            )
        else:
            await interaction.followup.send(f"API returned {r.status_code}.", ephemeral=True)
    except Exception as e:
        await interaction.followup.send(f"Error: {e}", ephemeral=True)


@tree.command(name="connect", description="Link a bank account via TrueLayer")
async def cmd_connect(interaction: discord.Interaction):
    await interaction.response.defer(ephemeral=True)
    data = await api_get("/auth/truelayer/link")
    if not data:
        await interaction.followup.send("Could not reach the backend.", ephemeral=True)
        return
    embed = discord.Embed(
        title="Connect Your Bank",
        description=f"[Click here to connect your bank]({data['auth_url']})\n\nAfter authorising, use `/summary` to see your data.",
        colour=0x2ecc71,
    )
    await interaction.followup.send(embed=embed, ephemeral=True)

# ─── Events ───────────────────────────────────────────────────────────────────

@client.event
async def on_ready():
    await tree.sync()
    poll_transactions.start()
    periodic_sync.start()
    channel = client.get_channel(DISCORD_CHANNEL_ID)
    if channel:
        state = load_state()
        start, end = get_pay_period(state)
        embed = discord.Embed(
            title="Wealth Guide is online",
            description=(
                f"Current pay period: **{start.strftime('%d %b')} → {end.strftime('%d %b')}**\n\n"
                "`/summary` — total balance\n"
                "`/accounts` — browse per-account transactions\n"
                "`/spend` — pay period breakdown (by type / by account)\n"
                "`/categorise` — label your transactions\n"
                "`/budget` / `/setbudget` — track spending limits\n"
                "`/setpayday` — override payday for a month\n"
                "`/insights` — savings opportunities\n"
                "`/ask` — AI finance guide\n"
                "`/connect` — link a bank"
            ),
            colour=0x5865f2,
            timestamp=datetime.now(),
        )
        msg = await channel.send(embed=embed)
        await msg.delete(delay=30)
    print(f"Wealth Guide online as {client.user}")


if __name__ == "__main__":
    client.run(DISCORD_BOT_TOKEN)
