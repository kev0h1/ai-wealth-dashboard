from app.core.crypto import encrypt_token, decrypt_token, is_encrypted


def test_roundtrip():
    token = "tl-access-token-abc123"
    enc = encrypt_token(token)
    assert enc != token
    assert is_encrypted(enc)
    assert decrypt_token(enc) == token


def test_plaintext_passthrough():
    # Legacy unencrypted tokens must survive decrypt unchanged
    assert decrypt_token("plain-legacy-token") == "plain-legacy-token"
    assert not is_encrypted("plain-legacy-token")


def test_none_and_empty():
    assert encrypt_token(None) is None
    assert decrypt_token(None) is None
    assert encrypt_token("") == ""
    assert decrypt_token("") == ""
