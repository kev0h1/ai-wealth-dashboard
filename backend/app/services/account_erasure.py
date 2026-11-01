"""The one routine that erases an account: revoke its session tokens, then
erase every document (which first revokes every live bank consent).

Shared by DELETE /account (the user's own request, app.routers.profile) and
the owner's "remove user" action on /ops/people (E12), so both run exactly
the same steps in the same order. The dormant-account sweep in
app.services.retention does the same two calls itself."""
from app.core.session_revocation import revoke_sessions
from app.services.retention import erase_user


async def erase_account(uid: str) -> dict[str, int]:
    # A84: revoke this user's session tokens BEFORE erasing, not inside
    # erase_user itself (that function is shared with the dormant sweep), so a
    # concurrent request racing the erasure, using the same still-valid token,
    # is already locked out from the moment it starts.
    await revoke_sessions(uid)
    # erase_user revokes every Finexer / TrueLayer consent first (A82, A157).
    return await erase_user(uid)
