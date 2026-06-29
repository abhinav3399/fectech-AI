"""Database models (SQLModel). A carer account + their app state.

Named db_models (not models) because app/models/ is already a package of pydantic
request/response schemas — keep the two clearly separate.

UserState holds the whole client store (profile/persona/memories/reminders/contacts)
as one JSON document — the fastest faithful migration from the localStorage-only model.
It can be normalized into per-entity tables later without changing the auth/sync contract.
"""
import time
from typing import Optional

from sqlmodel import SQLModel, Field, Column, JSON


class User(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    email: str = Field(index=True, unique=True)
    password_hash: str
    salt: str
    created_at: float = Field(default_factory=lambda: time.time())


class UserState(SQLModel, table=True):
    user_id: int = Field(primary_key=True, foreign_key="user.id")
    data: dict = Field(default_factory=dict, sa_column=Column(JSON))
    updated_at: float = Field(default_factory=lambda: time.time())


class AdherenceLog(SQLModel, table=True):
    """One row per medication-reminder outcome (taken/snoozed/skipped/missed). Tied to the
    carer's account when signed in (user_id), else to a stable kiosk_id (e.g. the profile name)."""
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: Optional[int] = Field(default=None, foreign_key="user.id", index=True)
    kiosk_id: Optional[str] = Field(default=None, index=True)
    reminder_id: str = ""
    title: str = ""
    type: str = "medication"
    status: str = "taken"  # taken | snoozed | skipped | missed
    ts: float = Field(default_factory=lambda: time.time())
