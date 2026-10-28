"""G355: match "my Monzo current account" to one of the user's accounts.

Pure scoring, no I/O. A reference is split into words, filler words dropped
("my", "the", "account", "bank"), and every remaining word must be explained by
the account: its bank (from the provider), a word of its raw or tidied name, or
its kind (current, savings, credit, investment, offline). The highest score
wins when it is unique, a tie is ambiguous. A holder-named account ("Kevin
Mbithi Maingi") is therefore reachable by its bank and kind.

Anything listed back to the user goes through `safe_label`: the G337 account
label with the kind appended, never a raw name that could be a person's.
"""
import re

STOPWORDS = frozenset({
    "my", "the", "a", "an", "account", "acct", "bank", "from", "into", "in", "to", "please", "of", "one", "use", "using",
})

_KIND_WORDS = {
    "current": {"Current"}, "checking": {"Current"}, "everyday": {"Current"},
    "savings": {"Savings"}, "saving": {"Savings"}, "saver": {"Savings"}, "pot": {"Savings"},
    "isa": {"Savings", "Investment"},
    "credit": {"Credit"}, "card": {"Credit"},
    "cash": {"Offline"}, "offline": {"Offline"}, "manual": {"Offline"},
    "investment": {"Investment"}, "stocks": {"Investment"}, "sipp": {"Investment"}, "pension": {"Investment"},
}

_LEGACY = 100
_EXACT = 50


def words(text) -> list[str]:
    """Lower-case alphanumeric words with the trailing-s strip `_name_matches` uses."""
    out = []
    for w in re.findall(r"[a-z0-9]+", str(text or "").lower()):
        out.append(w[:-1] if len(w) > 3 and w.endswith("s") else w)
    return out


_KIND_BY_WORD = {}
for _w, _k in _KIND_WORDS.items():
    _KIND_BY_WORD.setdefault(words(_w)[0], set()).update(_k)


def reference_tokens(ref) -> list[str]:
    return [w for w in words(ref) if w not in STOPWORDS]


def bank_words(provider) -> set[str]:
    """Words naming the account's bank: "ob-barclays" gives {"barclays"}."""
    raw = str(provider or "").lower().strip()
    if not raw or raw == "bank":
        return set()
    if raw.startswith("ob-"):
        raw = raw[3:]
    return set(words(raw.replace("_", " ").replace("-", " ")))


def score(ref: str, account, kind: str, legacy_hit: bool) -> int:
    """0 when the account does not fit the reference, else a score (higher is
    a closer fit). `legacy_hit` is the old raw-name substring match, kept as
    the strongest signal so every phrasing that used to work still does."""
    from app.services.account_names import display_account_name

    tokens = reference_tokens(ref)
    ref_norm = " ".join(words(ref))
    if legacy_hit:
        bonus = _EXACT if ref_norm and ref_norm in (" ".join(words(account.name)), " ".join(words(display_account_name(account.name)))) else 0
        return _LEGACY + bonus
    if not tokens:
        return 0
    product = set(words(account.name)) | set(words(display_account_name(account.name)))
    bank = bank_words(getattr(account, "provider", None))
    total = 0
    for t in tokens:
        if t in product:
            total += 3
        elif t in bank:
            total += 2
        elif kind in _KIND_BY_WORD.get(t, ()):
            total += 1
        else:
            return 0
    return total


def pick(ref: str, accounts: list, kind_of, name_matches) -> list:
    """The best-scoring accounts for a reference: one means resolved, several
    means a tie, none means no match."""
    scored = []
    for a in accounts:
        s = score(ref, a, kind_of(a), bool(name_matches(ref, a.name)))
        if s:
            scored.append((s, a))
    if not scored:
        return []
    top = max(s for s, _a in scored)
    return [a for s, a in scored if s == top]


def safe_label(account, kind: str, tokens: list[str] | None) -> str:
    """"your Monzo account, current" or "Barclays Premier Current Account, current"."""
    from app.services.account_names import display_account_name
    from app.services.penny_consolidation import source_label

    base = source_label(display_account_name(account.name), getattr(account, "provider", None), tokens)
    return f"{base}, {kind.lower()}"


def labelled(accounts: list, kind_of, tokens: list[str] | None, limit: int = 8) -> tuple[list[str], int]:
    """(labels grouped by bank, number left out). Never a raw name."""
    from app.services.companion import _bank_name_of

    rows = sorted(
        ((_bank_name_of(getattr(a, "provider", None)) or "~", safe_label(a, kind_of(a), tokens)) for a in accounts),
        key=lambda r: (r[0].lower(), r[1].lower()),
    )
    labels = [label for _bank, label in rows]
    return labels[:limit], max(0, len(labels) - limit)
