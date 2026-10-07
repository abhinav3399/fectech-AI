"""Database engine + session/init helpers (SQLModel over SQLite by default)."""
from sqlmodel import SQLModel, create_engine, Session

from app.core.config import settings

_connect_args = {"check_same_thread": False} if settings.DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(settings.DATABASE_URL, echo=False, connect_args=_connect_args)


def init_db():
    """Create tables if they don't exist (non-destructive)."""
    import app.db_models  # noqa: F401 — register table metadata
    SQLModel.metadata.create_all(engine)


def get_session():
    with Session(engine) as session:
        yield session
