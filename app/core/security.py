"""Auth primitives — stdlib only (no heavy auth deps).

Passwords: salted PBKDF2-HMAC-SHA256 (200k iterations).
Tokens:    compact "<payload>.<sig>" — base64url(JSON) signed with HMAC-SHA256 and an
           embedded expiry. JWT-like, but dependency-free. Verified in constant time.
"""
import base64
import hashlib
import hmac
import json
import os
import time

_ITER = 200_000


def _b64(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).decode().rstrip("=")


def _unb64(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def hash_password(password: str, salt: bytes = None):
    """Return (salt_b64, hash_b64)."""
    salt = salt or os.urandom(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, _ITER)
    return _b64(salt), _b64(dk)


def verify_password(password: str, salt_b64: str, hash_b64: str) -> bool:
    try:
        dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), _unb64(salt_b64), _ITER)
        return hmac.compare_digest(_b64(dk), hash_b64)
    except Exception:
        return False


def make_token(user_id: int, secret: str, ttl_hours: int = 720) -> str:
    payload = {"uid": int(user_id), "exp": int(time.time()) + ttl_hours * 3600}
    body = _b64(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    sig = _b64(hmac.new(secret.encode("utf-8"), body.encode("utf-8"), hashlib.sha256).digest())
    return f"{body}.{sig}"


def verify_token(token: str, secret: str):
    """Return the user_id if valid & unexpired, else None."""
    try:
        body, sig = token.split(".", 1)
        expected = _b64(hmac.new(secret.encode("utf-8"), body.encode("utf-8"), hashlib.sha256).digest())
        if not hmac.compare_digest(sig, expected):
            return None
        payload = json.loads(_unb64(body))
        if int(payload.get("exp", 0)) < int(time.time()):
            return None
        return int(payload.get("uid"))
    except Exception:
        return None
