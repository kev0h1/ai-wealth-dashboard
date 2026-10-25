"""B60: propose_connect_bank, the start of connecting a bank, proposal first.

Penny never connects a bank. The tool builds a confirm card that shows the
Finexer and agency disclosure; the user taps Continue to Finexer on the card,
the app opens its bank picker and the normal consent flow starts. The
executor (can_i._execute_connect_bank) is record-only: it writes nothing.
"""
import re

from app.content.regulatory import AGENT_DISCLOSURE, TRADING_NAME_DISCLOSURE

CONNECT_CLOSING = "Tap Continue to Finexer to review permissions and connect. Nothing is connected until you finish with Finexer."

PROPOSE_CONNECT_BANK_SCHEMA = {
    "type": "function",
    "function": {
        "name": "propose_connect_bank",
        "description": (
            "Start connecting a bank account, the same thing Add a bank on Accounts does. Penny never "
            "connects a bank herself: this builds a card that shows the Finexer disclosure and a "
            "Continue to Finexer button, and only when the user taps it does the app open the bank "
            "picker and the normal consent flow with Finexer. Use it for 'connect my Monzo account' "
            "and 'add another bank'. bank is optional, the bank's name as the user says it; leave it "
            "out when they have not named one. Never say the bank is connected: nothing is connected "
            "until the user finishes with Finexer."
        ),
        "parameters": {
            "type": "object",
            "properties": {"bank": {"type": "string", "description": "Optional bank name, as the user says it."}},
            "required": [],
        },
    },
}


def consequence_text() -> str:
    return f"{TRADING_NAME_DISCLOSURE} {AGENT_DISCLOSURE} {CONNECT_CLOSING}"


async def exec_propose_connect_bank(uid: str, bank) -> dict:
    from app.services import penny_tools as pt

    name = re.sub(r"\s+", " ", str(bank or "")).strip()[:60] or None
    summary = f"Connect {name or 'a bank'} through Finexer"
    return await pt._create_proposal(
        uid, "connect_bank", {"bank": name}, summary, consequence_text(), entity=name,
    )
