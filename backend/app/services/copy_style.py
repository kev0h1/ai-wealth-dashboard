"""Shared house-copy post-processing.

Single home for the copy-rule backstops: the system prompts fed to every
LLM call already forbid dashes and the word "pounds", but this is a
post-hoc backstop for when the model does it anyway. Any surface that
phrases LLM output for the user should run it through `house_style` rather
than keeping its own copy of these regexes — two copies means one can be
fixed while the other silently keeps leaking the wrong copy into the app,
which is exactly the kind of drift this rule exists to prevent.
"""
import re

# House-style guardrail (originally can_i.py's _house_style): the system
# prompt already tells the model never to use an em-dash or en-dash, but
# live testing shows Haiku can still slip one into a short headline line.
# Post-hoc backstop, not a replacement for the instruction — replace with a
# comma so a stray dash never reaches a client. The facts array always
# spells a negative amount with the app's Unicode minus (see can_i.py's
# _fmt_gbp), but the model composes its own prose from the raw numeric
# facts and reaches for a plain hyphen ("-£184") — normalised to match here
# too.
_DASH_RE = re.compile(r"\s*[—–]\s*")
_HYPHEN_MINUS_GBP_RE = re.compile(r"-£")

# Currency-symbol guardrail: live testing on scenario.py's headline call
# showed the model spelling out "300 pounds" / "1,532.95 pounds" instead of
# using £, inconsistent with every other figure the app ever shows (always
# the £ symbol, never the word). The system prompt asks for £ explicitly,
# but this is the same kind of post-hoc backstop as the dash rule above —
# requesting it isn't the same as enforcing it. Matches a number (with
# optional thousands commas/decimals) immediately followed by "pound"/
# "pounds" (any case) and rewrites it in place as "£<number>", preserving
# whatever digits/punctuation the model wrote. Applied BEFORE the
# hyphen-minus rule below so a negative figure written as "-300 pounds"
# becomes "-£300" first, then "−£300" — the same pipeline a hyphen-minus
# figure that started life as "-£300" already goes through.
_POUNDS_WORD_RE = re.compile(r"(\d[\d,]*(?:\.\d+)?)\s*pounds?\b", re.IGNORECASE)


def house_style(text: str) -> str:
    """Replace any em-dash/en-dash with a comma, any "<number> pounds" with
    "£<number>", and any hyphen-minus directly before £ with the app's
    Unicode minus, per house copy rules."""
    text = _POUNDS_WORD_RE.sub(lambda m: f"£{m.group(1)}", text)
    text = _HYPHEN_MINUS_GBP_RE.sub("−£", text)
    return _DASH_RE.sub(", ", text).strip()
