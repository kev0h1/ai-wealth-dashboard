"""G315: synthetic fixtures for the tip rules. Kevin's five UAT examples
(2026-10-21) plus one case for every other tip category. Nothing here is real
user data. Shared by tests/test_g315_tip_rules.py and the review-doc renderer."""
from datetime import datetime

AS_OF = "2026-10-16"
FETCHED = datetime(2026, 10, 16, 9, 0)
VALID_UNTIL = datetime(2026, 10, 23, 9, 0)


def row(name, amount, *, recurring=True, n=3, last=None, last_amount=None, key=None):
    r = {"merchant_key": key or name.lower(), "display_name": name, "monthly_amount": amount,
         "occurrences": n, "overlapping_charge": False, "is_recurring": recurring}
    if last:
        r["last_date"] = last
        r["last_amount"] = last_amount if last_amount is not None else amount
    return r


def alt(name, price, ptype, host, basis="month"):
    return {"name": name, "price": price, "note": None, "product_type": ptype, "basis": basis, "source_host": host}


def doc(findings):
    return {"as_of": AS_OF, "fetched_at": FETCHED, "content_valid_until": VALID_UNTIL, "findings": findings}


# category -> (label of the case, triggered_by rows as the finder returns them, research findings)
CASES = {
    # 1. Bills / mobile: two places, SIM-only prices set against a bill that may include a handset.
    "mobile": (
        "Kevin 1: mobile",
        [row("Ee", 56.0), row("Voxi", 5.0)],
        {"typical_low": 5, "typical_high": 14, "deal": None,
         "alternatives": [alt("Three Mobile", 7, "sim_only", "uswitch.com"),
                          alt("VOXI", None, "sim_only", "uswitch.com"),
                          alt("SMARTY", None, "sim_only", "uswitch.com")],
         "sources": ["https://www.uswitch.com/mobiles/sim-only/", "https://www.moneysupermarket.com/mobile-phones/"]},
    ),
    # 2. Car finance: a regulated product, product types with no figures.
    "car_finance": (
        "Kevin 2: car finance",
        [row("M&S Loans", 429.0, last="2026-10-01", last_amount=429.0)],
        {"typical_low": None, "typical_high": None, "deal": None,
         "alternatives": [{"name": "PCP", "price": None, "note": None}, {"name": "HP", "price": None, "note": None}],
         "sources": ["https://www.moneysupermarket.com/car-finance/"]},
    ),
    # 3. Groceries: one brand under two descriptors, basket averages beside the spend.
    "groceries": (
        "Kevin 3: groceries",
        [row("Sainsburys Supermarket Birmin", 120.0, recurring=False, n=8),
         row("Sainsburys S/Mkts", 50.0, recurring=False, n=4),
         row("Tesco", 30.0, recurring=False, n=3), row("Aldi", 8.0, recurring=False, n=1)],
        {"typical_low": None, "typical_high": None, "deal": None,
         "alternatives": [alt("Aldi", 162, "basket", "trolley.co.uk"), alt("Lidl", 163, "basket", "trolley.co.uk"),
                          alt("Tesco", 182, "basket", "trolley.co.uk")],
         "sources": ["https://trolley.co.uk"]},
    ),
    # 4. Mortgage: an unknown lender, a lender comparison with no loan size, rate or term.
    "mortgage": (
        "Kevin 4: mortgage",
        [row("Mtg", 1124.44, last="2026-10-01", last_amount=1124.44)],
        {"typical_low": 1000, "typical_high": 1400, "deal": {"text": "Lenders list two year fixed rates", "valid_until": None},
         "alternatives": [alt("Yorkshire BS", 1167, "mortgage", "moneysupermarket.com"),
                          alt("West Brom", 1385, "mortgage", "moneysupermarket.com")],
         "sources": ["https://www.moneysupermarket.com/mortgages/"]},
    ),
    # 5. Health / gym: truncated name, a voucher reseller, an SEO price site, plus one genuine like-for-like listing.
    "gym": (
        "Kevin 5: gym",
        [row("David Lloyd Leisur", 61.0), row("David Lloyd Leisure Ltd", 0.0)],
        {"typical_low": 25, "typical_high": 80, "deal": None,
         "alternatives": [alt("David Lloyd via Groupon", 60, "gym_membership", "davidlloydmembership-price.co.uk"),
                          alt("PureGym", 25, "gym_membership", "which.co.uk")],
         "sources": ["https://davidlloydmembership-price.co.uk/", "https://www.which.co.uk/reviews/gyms"]},
    ),
    "energy": (
        "Other: energy",
        [row("Octopus Energy", 130.0)],
        {"typical_low": 90, "typical_high": 140, "deal": {"text": "Octopus lists a 12 month fixed tariff", "valid_until": "2026-10-31"},
         "alternatives": [alt("Outfox the Market", 112, "energy_tariff", "uswitch.com")],
         "sources": ["https://www.ofgem.gov.uk/energy-advice", "https://www.uswitch.com/gas-electricity/"]},
    ),
    "broadband": (
        "Other: broadband",
        [row("BT", 38.0)],
        {"typical_low": 22, "typical_high": 30, "deal": None,
         "alternatives": [alt("Community Fibre", 22, "broadband_only", "uswitch.com")],
         "sources": ["https://www.uswitch.com/broadband/"]},
    ),
    "car_insurance": (
        "Other: car insurance",
        [row("Admiral", 70.0, last="2026-10-09", last_amount=70.0)],
        {"typical_low": 55, "typical_high": 85, "deal": None,
         "alternatives": [alt("Direct Line", 64, "car_insurance", "comparethemarket.com")],
         "sources": ["https://www.moneysavingexpert.com/insurance/"]},
    ),
    "eating_out": (
        "Other: eating out",
        [row("Nandos", 60.0, recurring=False, n=5)],
        {"typical_low": None, "typical_high": None, "deal": {"text": "Voucher sites list restaurant offers", "valid_until": None},
         "alternatives": [alt("Tastecard", 5, "voucher", "tastecard.co.uk")],
         "sources": ["https://www.vouchercodes.co.uk/restaurants"]},
    ),
    "subscriptions": (
        "Other: subscriptions",
        [row("Netflix.Com", 12.99), row("Spotify", 11.99)],
        {"typical_low": 5, "typical_high": 18, "deal": None,
         "alternatives": [alt("Disney+", 5, "streaming_subscription", "which.co.uk")],
         "sources": ["https://www.which.co.uk/reviews/streaming-services"]},
    ),
}
