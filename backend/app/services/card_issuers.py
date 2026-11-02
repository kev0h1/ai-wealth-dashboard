"""G403: the one card issuer table.

Shared by `own_account_transfers` (the card repayment link) and
`categorisation` (the credit-only and debit-only issuer rules), so neither
imports the other for it. Add an issuer here, nowhere else.

`codes` are normalised provider codes a card account may carry; `printed` are
the forms an issuer is printed in on a bank narrative.
"""
from __future__ import annotations

CARD_ISSUERS: dict[str, dict] = {
    "american_express": {"label": "American Express", "codes": ("amex", "americanexpress"),
                         "printed": (r"american\s+express", r"amex"),
                         "card_forms": (r"american\s+express", r"amex")},
    "barclaycard": {"label": "Barclaycard", "codes": ("barclaycard", "barclays"),
                    "printed": (r"barclaycard", r"b/card", r"b\s+card"),
                    "card_forms": (r"barclaycard", r"b/card", r"b\s+card")},
    "natwest": {"label": "NatWest", "codes": ("natwest", "rbs"),
                "printed": (r"natwest", r"nw\s+world\s+master\w*", r"nw\s+master\w*"),
                "card_forms": (r"nw\s+world\s+master\w*", r"nw\s+master\w*")},
    "hsbc": {"label": "HSBC", "codes": ("hsbc",), "printed": (r"hsbc\s+credit\s+card",), "card_forms": (r"hsbc\s+credit\s+card",)},
    "chase": {"label": "Chase", "codes": ("chase",), "printed": (r"chase",), "card_forms": ()},
}
