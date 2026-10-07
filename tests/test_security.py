"""Unit tests for auth primitives — pure stdlib, fast, CI-safe."""
import time

from app.core.security import hash_password, verify_password, make_token, verify_token

SECRET = "test-secret-key"


def test_password_hash_roundtrip():
    salt, ph = hash_password("correct horse battery")
    assert verify_password("correct horse battery", salt, ph)
    assert not verify_password("wrong password", salt, ph)


def test_password_salts_differ():
    s1, h1 = hash_password("samepass")
    s2, h2 = hash_password("samepass")
    assert s1 != s2 and h1 != h2  # random salt -> different stored hash


def test_token_roundtrip():
    tok = make_token(42, SECRET, ttl_hours=1)
    assert verify_token(tok, SECRET) == 42


def test_token_rejects_tampering_and_wrong_secret():
    tok = make_token(7, SECRET)
    assert verify_token(tok, "other-secret") is None
    assert verify_token(tok[:-2] + ("aa" if not tok.endswith("aa") else "bb"), SECRET) is None
    assert verify_token("garbage", SECRET) is None


def test_token_expiry():
    body_ok = make_token(1, SECRET, ttl_hours=1)
    assert verify_token(body_ok, SECRET) == 1
    # An already-expired token (negative TTL) must be rejected.
    expired = make_token(1, SECRET, ttl_hours=0)
    time.sleep(1)
    assert verify_token(expired, SECRET) is None
