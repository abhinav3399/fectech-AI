"""Family update service — manage contacts, preferences, and report generation."""
import time
from datetime import datetime, timedelta
from typing import Optional, List
from sqlmodel import Session, select

from app.db_models import User, FamilyContact, FamilyUpdatePreference, FamilyUpdateHistory


class FamilyUpdateService:
    """Handle family contact management, preferences, and report generation."""

    # --- Contacts ---

    @staticmethod
    def create_contact(session: Session, user_id: int, name: str, relationship: str,
                       phone: Optional[str] = None, email: Optional[str] = None,
                       preferred_method: str = "email", is_emergency: bool = False) -> FamilyContact:
        """Create a new family contact."""
        contact = FamilyContact(
            user_id=user_id,
            name=name,
            relationship=relationship,
            phone=phone,
            email=email,
            preferred_method=preferred_method,
            is_emergency_contact=is_emergency
        )
        session.add(contact)
        session.commit()
        session.refresh(contact)
        return contact

    @staticmethod
    def get_user_contacts(session: Session, user_id: int) -> List[FamilyContact]:
        """Get all contacts for a user."""
        return session.exec(
            select(FamilyContact).where(FamilyContact.user_id == user_id).order_by(FamilyContact.created_at.desc())
        ).all()

    @staticmethod
    def get_active_contacts(session: Session, user_id: int) -> List[FamilyContact]:
        """Get only active contacts for a user."""
        return session.exec(
            select(FamilyContact)
            .where(FamilyContact.user_id == user_id, FamilyContact.is_active == True)
            .order_by(FamilyContact.created_at.desc())
        ).all()

    @staticmethod
    def get_contact(session: Session, user_id: int, contact_id: int) -> Optional[FamilyContact]:
        """Get a specific contact (verify it belongs to the user)."""
        return session.exec(
            select(FamilyContact).where(
                FamilyContact.id == contact_id,
                FamilyContact.user_id == user_id
            )
        ).first()

    @staticmethod
    def update_contact(session: Session, user_id: int, contact_id: int, **updates) -> Optional[FamilyContact]:
        """Update a contact."""
        contact = FamilyUpdateService.get_contact(session, user_id, contact_id)
        if not contact:
            return None
        for key, value in updates.items():
            if key in ["name", "relationship", "phone", "email", "preferred_method", "is_active", "is_emergency_contact"]:
                setattr(contact, key, value)
        contact.updated_at = time.time()
        session.add(contact)
        session.commit()
        session.refresh(contact)
        return contact

    @staticmethod
    def delete_contact(session: Session, user_id: int, contact_id: int) -> bool:
        """Delete a contact."""
        contact = FamilyUpdateService.get_contact(session, user_id, contact_id)
        if not contact:
            return False
        session.delete(contact)
        session.commit()
        return True

    @staticmethod
    def toggle_contact(session: Session, user_id: int, contact_id: int) -> Optional[FamilyContact]:
        """Toggle contact active/inactive."""
        contact = FamilyUpdateService.get_contact(session, user_id, contact_id)
        if not contact:
            return None
        contact.is_active = not contact.is_active
        contact.updated_at = time.time()
        session.add(contact)
        session.commit()
        session.refresh(contact)
        return contact

    # --- Preferences ---

    @staticmethod
    def get_or_create_preferences(session: Session, user_id: int) -> FamilyUpdatePreference:
        """Get or create user preferences."""
        prefs = session.exec(
            select(FamilyUpdatePreference).where(FamilyUpdatePreference.user_id == user_id)
        ).first()
        if not prefs:
            prefs = FamilyUpdatePreference(user_id=user_id)
            session.add(prefs)
            session.commit()
            session.refresh(prefs)
        return prefs

    @staticmethod
    def update_preferences(session: Session, user_id: int, **updates) -> FamilyUpdatePreference:
        """Update user preferences."""
        prefs = FamilyUpdateService.get_or_create_preferences(session, user_id)
        for key, value in updates.items():
            if key in [
                "is_enabled", "has_given_consent", "update_frequency",
                "include_status", "include_timestamp", "include_conversation_summary",
                "include_location", "next_scheduled_update", "last_update_sent"
            ]:
                setattr(prefs, key, value)
        prefs.updated_at = time.time()
        session.add(prefs)
        session.commit()
        session.refresh(prefs)
        return prefs

    # --- Report Generation ---

    @staticmethod
    def generate_status_report(session: Session, user_id: int, user: Optional[User] = None) -> str:
        """Generate a simple status report for family contacts."""
        if user is None:
            user = session.get(User, user_id)
            if not user:
                return "Unable to generate report: user not found."

        now = datetime.utcnow()
        report = f"""Factech AI Family Update
User ID: {user.email}
Time: {now.strftime('%Y-%m-%d %H:%M:%S UTC')}

Status: Available
Last interaction: {now.strftime('%I:%M %p')}

This is an automated family update message sent with explicit user consent.
If you have questions, please contact the account holder directly.
"""
        return report

    # --- History ---

    @staticmethod
    def log_update(session: Session, user_id: int, contact_id: int,
                   update_type: str = "scheduled", message: str = "",
                   status: str = "pending") -> FamilyUpdateHistory:
        """Log an update attempt."""
        history = FamilyUpdateHistory(
            user_id=user_id,
            contact_id=contact_id,
            update_type=update_type,
            message_content=message,
            delivery_status=status
        )
        session.add(history)
        session.commit()
        session.refresh(history)
        return history

    @staticmethod
    def mark_delivered(session: Session, history_id: int) -> Optional[FamilyUpdateHistory]:
        """Mark a history entry as delivered."""
        history = session.get(FamilyUpdateHistory, history_id)
        if not history:
            return None
        history.delivery_status = "sent"
        history.delivered_at = time.time()
        session.add(history)
        session.commit()
        session.refresh(history)
        return history

    @staticmethod
    def mark_failed(session: Session, history_id: int, error: str = "") -> Optional[FamilyUpdateHistory]:
        """Mark a history entry as failed."""
        history = session.get(FamilyUpdateHistory, history_id)
        if not history:
            return None
        history.delivery_status = "failed"
        history.error_message = error
        history.retry_count += 1
        session.add(history)
        session.commit()
        session.refresh(history)
        return history

    @staticmethod
    def get_user_history(session: Session, user_id: int, limit: int = 50) -> List[FamilyUpdateHistory]:
        """Get update history for a user."""
        return session.exec(
            select(FamilyUpdateHistory)
            .where(FamilyUpdateHistory.user_id == user_id)
            .order_by(FamilyUpdateHistory.created_at.desc())
            .limit(limit)
        ).all()

    @staticmethod
    def delete_history_entry(session: Session, user_id: int, history_id: int) -> bool:
        """Delete a history entry."""
        history = session.exec(
            select(FamilyUpdateHistory).where(
                FamilyUpdateHistory.id == history_id,
                FamilyUpdateHistory.user_id == user_id
            )
        ).first()
        if not history:
            return False
        session.delete(history)
        session.commit()
        return True

    @staticmethod
    def clear_user_history(session: Session, user_id: int) -> int:
        """Clear all history for a user."""
        histories = session.exec(
            select(FamilyUpdateHistory).where(FamilyUpdateHistory.user_id == user_id)
        ).all()
        for h in histories:
            session.delete(h)
        session.commit()
        return len(histories)

    # --- Scheduling Helpers ---

    @staticmethod
    def calculate_next_update_time(frequency: str) -> float:
        """Calculate next update time based on frequency."""
        now = datetime.utcnow()
        if frequency == "1h":
            delta = timedelta(hours=1)
        elif frequency == "3h":
            delta = timedelta(hours=3)
        elif frequency == "6h":
            delta = timedelta(hours=6)
        elif frequency == "12h":
            delta = timedelta(hours=12)
        elif frequency == "daily":
            delta = timedelta(days=1)
        else:
            delta = timedelta(hours=1)  # default
        next_time = now + delta
        return next_time.timestamp()

    @staticmethod
    def should_send_update(prefs: FamilyUpdatePreference) -> bool:
        """Check if an update should be sent now."""
        if not prefs.is_enabled or not prefs.has_given_consent:
            return False
        if prefs.next_scheduled_update is None:
            return True  # First time
        now = time.time()
        return now >= prefs.next_scheduled_update
