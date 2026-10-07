"""
create_demo_user.py — Run once to seed the demo/test account.

  python scripts/create_demo_user.py

WARNING: This is a DEMO/TEST account for development and APK testing.
         Change or disable it before public production deployment.

DEFAULT CREDENTIALS (documented here, NOT hardcoded in frontend):
  Email:    demo@factech.ai
  Password: Factech@123
"""

import os
import sys

# Ensure the project root is on the path so app.* imports work.
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

# Load .env so DATABASE_URL / SECRET_KEY are available.
try:
    from dotenv import load_dotenv
    load_dotenv(os.path.join(ROOT, ".env"))
except ImportError:
    pass  # python-dotenv optional — env vars may already be set

from sqlmodel import Session, select
from app.db import init_db, engine
from app.db_models import User
from app.core.security import hash_password

DEMO_EMAIL = "demo@factech.ai"
DEMO_PASSWORD = "Factech@123"


def create_demo_user():
    init_db()  # create tables if they don't exist yet

    with Session(engine) as session:
        existing = session.exec(select(User).where(User.email == DEMO_EMAIL)).first()
        if existing:
            print(f"[OK] Demo user already exists: {DEMO_EMAIL}")
            print("     To reset the password, delete the account from factech.db and re-run.")
            return

        salt, password_hash = hash_password(DEMO_PASSWORD)
        user = User(email=DEMO_EMAIL, password_hash=password_hash, salt=salt)
        session.add(user)
        session.commit()
        session.refresh(user)
        print(f"[CREATED] Demo user: {DEMO_EMAIL}  (id={user.id})")

    print()
    print("=" * 55)
    print("  DEFAULT TEST LOGIN")
    print(f"  ID/Email : {DEMO_EMAIL}")
    print(f"  Password : {DEMO_PASSWORD}")
    print("=" * 55)
    print()
    print("  ⚠️  SECURITY REMINDER:")
    print("  This account is for APK testing ONLY.")
    print("  Disable or change the password before public release.")
    print()


if __name__ == "__main__":
    create_demo_user()
