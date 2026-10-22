"""Encryption-at-rest for bank tokens.

Key resolution order: TOKEN_ENCRYPTION_KEY env var (use this in prod, inject
from a secret manager), else backend/.token_key file (generated on first run,
gitignored; this file IS UAT's key, UAT sets no env var). Losing the key means
users must reconnect their banks; nothing else is lost.

Rotation (A171): set TOKEN_ENCRYPTION_KEY_PREVIOUS to the outgoing key while
TOKEN_ENCRYPTION_KEY holds the new one. New ciphertext is always written under
the primary key only; reads try the primary first, then the previous key. Run
backend/scripts/reencrypt_tokens.py (dry run, then --apply) until nothing is
left under the previous key, then remove TOKEN_ENCRYPTION_KEY_PREVIOUS. ENV.md
("Secret rotation") has the full runbook. A ciphertext that neither key opens
fails closed (decrypt_token returns None). The ciphertext format is unchanged
(plain Fernet tokens), so every existing stored value stays readable.
"""
import hashlib
import logging
import os
from pathlib import Path
from typing import Optional

from cryptography.fernet import Fernet, InvalidToken

logger = logging.getLogger(__name__)

_BACKEND_DIR = Path(__file__).parent.parent.parent
_key_file = _BACKEND_DIR / ".token_key"

# Fernet ciphertext is base64 and always starts with this version prefix,
# which lets us tell encrypted values apart from legacy plaintext tokens.
_FERNET_PREFIX = "gAAAAA"


class KeyRing:
    """A primary Fernet key plus an optional previous one. Encrypts with the
    primary only; decrypts with either. Built from raw key strings so tests and
    the re-encryption script can construct rings without touching the env."""

    def __init__(self, primary: str | bytes, previous: str | bytes | None = None):
        self._primary = Fernet(primary)
        self._previous = Fernet(previous) if previous else None

    @property
    def has_previous(self) -> bool:
        return self._previous is not None

    def encrypt(self, value: Optional[str]) -> Optional[str]:
        if not value:
            return value
        return self._primary.encrypt(value.encode()).decode()

    def classify(self, value: Optional[str]) -> str:
        """'empty' | 'plaintext' | 'primary' | 'previous' | 'unknown'."""
        if not value:
            return "empty"
        if not value.startswith(_FERNET_PREFIX):
            return "plaintext"
        try:
            self._primary.decrypt(value.encode())
            return "primary"
        except InvalidToken:
            pass
        if self._previous is not None:
            try:
                self._previous.decrypt(value.encode())
                return "previous"
            except InvalidToken:
                pass
        return "unknown"

    def decrypt(self, value: Optional[str]) -> Optional[str]:
        """Legacy plaintext passes through; a value no key opens returns None."""
        if not value or not value.startswith(_FERNET_PREFIX):
            return value
        for f in (self._primary, self._previous):
            if f is None:
                continue
            try:
                return f.decrypt(value.encode()).decode()
            except InvalidToken:
                continue
        return None

    def reencrypt_if_previous(self, value: str) -> Optional[str]:
        """New primary-key ciphertext when `value` opens only under the previous
        key; None in every other case (already primary, plaintext, unknown)."""
        if self.classify(value) != "previous":
            return None
        return self.encrypt(self.decrypt(value))


def _load_primary() -> bytes:
    if _k := os.getenv("TOKEN_ENCRYPTION_KEY"):
        return _k.encode()
    if _key_file.exists():
        return _key_file.read_text().strip().encode()
    key = Fernet.generate_key()
    _key_file.write_text(key.decode())
    _key_file.chmod(0o600)
    return key


_previous_env = os.getenv("TOKEN_ENCRYPTION_KEY_PREVIOUS", "").strip()
_ring = KeyRing(_load_primary(), _previous_env or None)
if _previous_env:
    # Never logs a key; the warning is a reminder to finish the rotation.
    logger.warning(
        "TOKEN_ENCRYPTION_KEY_PREVIOUS is set: tokens are readable under the "
        "previous key. Run scripts/reencrypt_tokens.py, then remove it."
    )


def get_ring() -> KeyRing:
    return _ring


def encrypt_token(value: Optional[str]) -> Optional[str]:
    return _ring.encrypt(value)


def decrypt_token(value: Optional[str]) -> Optional[str]:
    """Decrypt a stored token. Legacy plaintext values pass through unchanged;
    a value encrypted under an unknown key returns None (unusable)."""
    return _ring.decrypt(value)


def is_encrypted(value: Optional[str]) -> bool:
    return bool(value) and value.startswith(_FERNET_PREFIX)


def token_fingerprint(value: str) -> str:
    """Deterministic, non-reversible lookup key for a bank credential that
    must ALSO serve as a document/join id (e.g. Yapily's consent token,
    which a provider both issues to us as an opaque identifier and expects
    back verbatim as a bearer header — unlike TrueLayer, where the OAuth
    `state`/connection id we mint ourselves is a different value from the
    access token).

    Fernet ciphertext isn't exact-match queryable (it's randomised per
    call), so the encrypted value itself can't be used as `_id`. A SHA-256
    fingerprint can: same input always yields the same fingerprint, so
    lookups by the raw value coming back from a provider callback still
    work, while the fingerprint alone can't be reversed to the credential.
    The recoverable credential is stored separately via encrypt_token.
    """
    return hashlib.sha256(value.encode()).hexdigest()
