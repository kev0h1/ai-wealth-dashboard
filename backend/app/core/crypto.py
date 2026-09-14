"""Encryption-at-rest for bank tokens.

Key resolution order: TOKEN_ENCRYPTION_KEY env var (use this in prod — inject
from a secret manager), else backend/.token_key file (generated on first run,
gitignored). Losing the key means users must reconnect their banks; nothing
else is lost.
"""
import hashlib
import os
from pathlib import Path
from typing import Optional

from cryptography.fernet import Fernet, InvalidToken

_BACKEND_DIR = Path(__file__).parent.parent.parent
_key_file = _BACKEND_DIR / ".token_key"

if _k := os.getenv("TOKEN_ENCRYPTION_KEY"):
    _key = _k.encode()
elif _key_file.exists():
    _key = _key_file.read_text().strip().encode()
else:
    _key = Fernet.generate_key()
    _key_file.write_text(_key.decode())
    _key_file.chmod(0o600)

_fernet = Fernet(_key)

# Fernet ciphertext is base64 and always starts with this version prefix,
# which lets us tell encrypted values apart from legacy plaintext tokens.
_FERNET_PREFIX = "gAAAAA"


def encrypt_token(value: Optional[str]) -> Optional[str]:
    if not value:
        return value
    return _fernet.encrypt(value.encode()).decode()


def decrypt_token(value: Optional[str]) -> Optional[str]:
    """Decrypt a stored token. Legacy plaintext values pass through unchanged."""
    if not value or not value.startswith(_FERNET_PREFIX):
        return value
    try:
        return _fernet.decrypt(value.encode()).decode()
    except InvalidToken:
        # Encrypted under a lost/rotated key — treat as unusable
        return None


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
