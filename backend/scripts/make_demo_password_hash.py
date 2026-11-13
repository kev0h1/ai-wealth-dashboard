#!/usr/bin/env python3
"""C43: print the DEMO_PASSWORD_HASH value for a password you type.

Reads the password with getpass (no echo, never a command-line argument, never
stored) and prints only the scrypt hash string, which is what goes into the
DEMO_PASSWORD_HASH environment variable. The password itself is never printed
or written anywhere.

Usage, from backend/:
    .venv/bin/python scripts/make_demo_password_hash.py
"""
import getpass
import sys
from pathlib import Path

_BACKEND = Path(__file__).resolve().parents[1]
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

MIN_LENGTH = 12


def main() -> int:
    from app.core.demo import hash_password
    first = getpass.getpass("Demo password: ")
    if len(first) < MIN_LENGTH:
        print(f"Refusing: use at least {MIN_LENGTH} characters.", file=sys.stderr)
        return 2
    if getpass.getpass("Repeat it: ") != first:
        print("Refusing: the two entries differ.", file=sys.stderr)
        return 2
    print(hash_password(first))
    return 0


if __name__ == "__main__":
    sys.exit(main())
