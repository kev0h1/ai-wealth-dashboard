"""Shared copy for cross-provider identity-linking prompts.

D9 (Apple Hide My Email relay-claim path 1) surfaces this exact prompt on a
refused relay sign-in: sign in with whichever provider the invite was
actually sent to, then link Apple from Settings (POST
/auth/identities/apple, unchanged). D10 describes the same prompt at Apple
sign-up more generally (before the two-account situation exists at all) and
must reuse this constant rather than duplicate the copy — one string this
codebase's copy rules (no em dashes, British English) need to be checked
against once, not once per caller.
"""

APPLE_RELAY_LINK_EXISTING_ACCOUNT_PROMPT = (
    "Already using Sorted with Google? Sign in with that and add Apple "
    "from Settings."
)
