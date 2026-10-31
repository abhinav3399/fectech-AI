"""Test isolation: never lock or mutate the developer's live Qdrant store."""
import os
import tempfile

_TEST_ROOT = tempfile.mkdtemp(prefix="factech-tests-")
os.environ.setdefault("QDRANT_MODE", "local")
os.environ["QDRANT_PATH"] = os.path.join(_TEST_ROOT, "qdrant_storage")
os.environ.setdefault("DATABASE_URL", f"sqlite:///{os.path.join(_TEST_ROOT, 'factech-test.db')}")
