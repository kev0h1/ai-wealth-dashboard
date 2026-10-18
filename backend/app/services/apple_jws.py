"""Apple JWS verification for App Store Server Notifications V2 and signed
transactions (C21, docs/pricing/store-billing-c13.md sections 5 and 10).

Implemented with the `cryptography` and `PyJWT` packages already in the
venv. Apple's `app-store-server-library` is not a dependency and none was
added.

What a signed Apple payload is: a JWS (compact, three dot-separated base64url
parts) whose header carries `alg: ES256` and `x5c`, a certificate chain
[leaf, intermediate, root]. The leaf's public key signs the payload. Trusting
it therefore means (1) the chain is rooted in a certificate WE pinned, not one
the payload asserts, (2) every link is a real signature by the next
certificate, (3) every certificate is inside its validity window, and (4) the
JWS signature verifies under the leaf's key. All four are done here and any
failure raises AppleVerificationError, which the receiver turns into a 4xx.
Nothing in the payload is read before the signature has verified.

Pinned roots: every certificate file (.cer .der .crt .pem) in
APPLE_ROOT_CERTS_DIR (backend/app/certs/apple_roots by default). The real
Apple Root CA - G3 must be placed there by a human from Apple's PKI page
(https://www.apple.com/certificateauthority/); this module has no network
access and ships no root of its own. With no root present nothing verifies
and the receiver answers 503 (fail closed).

Marker extensions: Apple's own library additionally requires the leaf to
carry OID 1.2.840.113635.100.6.11.1 and the intermediate
1.2.840.113635.100.6.2.1. They are enforced here too (REQUIRE_APPLE_MARKER_OIDS)
because they tie the chain to Apple's App Store signing hierarchy rather than
any certificate Apple issued. UNCONFIRMED against live payloads (C13 section
10): if a real sandbox payload fails on them, the failure is logged by
reason and the receiver is wrong in the safe direction.

Unit tests build their own test CA with the same shape and pin it in place of
Apple's root; production replaces it with Apple's real root and changes
nothing else.
"""
import base64
import binascii
import json
import logging
from datetime import datetime, timezone
from pathlib import Path

import jwt
from cryptography import x509
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec

logger = logging.getLogger(__name__)

MAX_JWS_BYTES = 128 * 1024
LEAF_MARKER_OID = x509.ObjectIdentifier("1.2.840.113635.100.6.11.1")
INTERMEDIATE_MARKER_OID = x509.ObjectIdentifier("1.2.840.113635.100.6.2.1")
REQUIRE_APPLE_MARKER_OIDS = True

_CERT_SUFFIXES = {".cer", ".der", ".crt", ".pem"}


class AppleVerificationError(Exception):
    """The payload cannot be trusted. The message names the stage that
    failed (never payload contents) and is safe to log."""


def load_pinned_roots(directory: Path | str) -> list[x509.Certificate]:
    """Every parseable certificate in `directory`, PEM or DER. A file that
    does not parse is skipped with a warning naming only the file name."""
    root = Path(directory)
    out: list[x509.Certificate] = []
    if not root.is_dir():
        return out
    for path in sorted(root.iterdir()):
        if path.suffix.lower() not in _CERT_SUFFIXES or not path.is_file():
            continue
        data = path.read_bytes()
        try:
            cert = x509.load_pem_x509_certificate(data) if b"BEGIN CERTIFICATE" in data else x509.load_der_x509_certificate(data)
        except ValueError:
            logger.warning("apple roots: %s is not a certificate, skipped", path.name)
            continue
        out.append(cert)
    return out


def _b64url_decode(part: str) -> bytes:
    try:
        return base64.urlsafe_b64decode(part + "=" * (-len(part) % 4))
    except (binascii.Error, ValueError) as exc:
        raise AppleVerificationError("malformed base64url") from exc


def _within_validity(cert: x509.Certificate, now: datetime) -> bool:
    return cert.not_valid_before_utc <= now <= cert.not_valid_after_utc


def _is_ca(cert: x509.Certificate) -> bool:
    try:
        return bool(cert.extensions.get_extension_for_class(x509.BasicConstraints).value.ca)
    except x509.ExtensionNotFound:
        return False


def _has_oid(cert: x509.Certificate, oid: x509.ObjectIdentifier) -> bool:
    try:
        cert.extensions.get_extension_for_oid(oid)
        return True
    except x509.ExtensionNotFound:
        return False


def _issued_by(cert: x509.Certificate, issuer: x509.Certificate) -> bool:
    try:
        cert.verify_directly_issued_by(issuer)
        return True
    except (ValueError, TypeError, InvalidSignature):
        return False


def verify_chain(
    x5c: list, roots: list[x509.Certificate], now: datetime | None = None,
    *, require_marker_oids: bool | None = None,
) -> x509.Certificate:
    """Validate an x5c chain against the pinned `roots` and return the leaf
    certificate. Raises AppleVerificationError naming the failed stage."""
    now = now or datetime.now(timezone.utc)  # naive-ok: aware instant for certificate validity
    require = REQUIRE_APPLE_MARKER_OIDS if require_marker_oids is None else require_marker_oids
    if not roots:
        raise AppleVerificationError("no pinned root certificate")
    if not isinstance(x5c, list) or not 2 <= len(x5c) <= 4 or not all(isinstance(c, str) for c in x5c):
        raise AppleVerificationError("x5c chain has an unexpected shape")
    try:
        chain = [x509.load_der_x509_certificate(base64.b64decode(c, validate=True)) for c in x5c]
    except (binascii.Error, ValueError) as exc:
        raise AppleVerificationError("x5c certificate does not parse") from exc

    # Anchor: the chain's last certificate is either one of our pinned roots
    # (byte for byte) or is directly issued by one. A root the payload merely
    # claims, which we did not pin, never anchors anything.
    last = chain[-1]
    anchor = next((r for r in roots if r.fingerprint(hashes.SHA256()) == last.fingerprint(hashes.SHA256())), None)
    links = chain[:-1] if anchor is not None else list(chain)
    if anchor is None:
        anchor = next((r for r in roots if _issued_by(last, r)), None)
    if anchor is None:
        raise AppleVerificationError("chain does not lead to a pinned root")

    path = [*links, anchor]
    for cert in path:
        if not _within_validity(cert, now):
            raise AppleVerificationError("certificate outside its validity window")
    for child, issuer in zip(path, path[1:]):
        if not _issued_by(child, issuer):
            raise AppleVerificationError("certificate is not signed by the next in the chain")
    for issuer in path[1:]:
        if not _is_ca(issuer):
            raise AppleVerificationError("issuer certificate is not a CA")
    leaf = path[0]
    if require:
        if not _has_oid(leaf, LEAF_MARKER_OID):
            raise AppleVerificationError("leaf certificate lacks the App Store marker")
        if len(path) > 2 and not _has_oid(path[1], INTERMEDIATE_MARKER_OID):
            raise AppleVerificationError("intermediate certificate lacks the App Store marker")
    return leaf


def verify_and_decode(token: str, roots: list[x509.Certificate], now: datetime | None = None) -> dict:
    """Verify one Apple JWS end to end and return its payload as a plain
    dict. Raises AppleVerificationError for any failure; never returns an
    unverified payload."""
    if not isinstance(token, str) or not token or len(token) > MAX_JWS_BYTES or token.count(".") != 2:
        raise AppleVerificationError("not a compact JWS")
    header_part = token.split(".", 1)[0]
    try:
        header = json.loads(_b64url_decode(header_part))
    except (ValueError, UnicodeDecodeError) as exc:
        raise AppleVerificationError("JWS header is not JSON") from exc
    if not isinstance(header, dict) or header.get("alg") != "ES256":
        raise AppleVerificationError("JWS algorithm is not ES256")
    leaf = verify_chain(header.get("x5c"), roots, now)
    key = leaf.public_key()
    if not isinstance(key, ec.EllipticCurvePublicKey) or not isinstance(key.curve, ec.SECP256R1):
        raise AppleVerificationError("leaf key is not P-256")
    try:
        payload = jwt.decode(
            token, key=key, algorithms=["ES256"],
            options={"verify_signature": True, "verify_exp": False, "verify_nbf": False,
                     "verify_iat": False, "verify_aud": False, "verify_iss": False, "require": []},
        )
    except jwt.PyJWTError as exc:
        raise AppleVerificationError("JWS signature does not verify") from exc
    if not isinstance(payload, dict):
        raise AppleVerificationError("JWS payload is not an object")
    return payload
