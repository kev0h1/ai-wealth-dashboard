"""Encryption-at-rest for bank tokens.

Key resolution order: TOKEN_ENCRYPTION_KEY env var (use this in prod — inject
from a secret manager), else backend/.token_key file (generated on first run,
gitignored). Losing the key means users must reconnect their banks; nothing
else is lost.
"""
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
