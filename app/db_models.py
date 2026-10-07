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


# --- Family Safety & Update Feature ---

class FamilyContact(SQLModel, table=True):
    """A family member who can receive status updates."""
    __tablename__ = "family_contact"
    
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    name: str  # e.g., "Mother", "Father"
    relationship: str = ""  # "Mother", "Father", "Brother", "Sister", "Caregiver"
    phone: Optional[str] = None
    email: Optional[str] = None
    preferred_method: str = "email"  # "email", "sms", "whatsapp", "push"
    is_active: bool = True
    is_emergency_contact: bool = False
    created_at: float = Field(default_factory=lambda: time.time())
    updated_at: float = Field(default_factory=lambda: time.time())


class FamilyUpdatePreference(SQLModel, table=True):
    """User's preferences for family updates."""
    __tablename__ = "family_update_preference"
    
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True, unique=True)
    is_enabled: bool = False
    has_given_consent: bool = False
    update_frequency: str = "daily"  # "1h", "3h", "6h", "12h", "daily"
    include_status: bool = True
    include_timestamp: bool = True
    include_conversation_summary: bool = False
    include_location: bool = False
    next_scheduled_update: Optional[float] = None
    last_update_sent: Optional[float] = None
    created_at: float = Field(default_factory=lambda: time.time())
    updated_at: float = Field(default_factory=lambda: time.time())


class FamilyUpdateHistory(SQLModel, table=True):
    """Log of every update sent to family contacts."""
    __tablename__ = "family_update_history"
    
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    contact_id: int = Field(foreign_key="family_contact.id", index=True)
    update_type: str = "scheduled"  # "scheduled", "sos", "manual"
    message_content: str = ""
    delivery_status: str = "pending"  # "sent", "failed", "pending"
    sent_at: float = Field(default_factory=lambda: time.time())
    delivered_at: Optional[float] = None
    error_message: Optional[str] = None
    retry_count: int = 0
    created_at: float = Field(default_factory=lambda: time.time())
