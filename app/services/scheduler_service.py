"""Background scheduler for family updates."""
import logging
import time
from datetime import datetime

from app.db import get_session
from app.db_models import FamilyUpdatePreference
from app.services.family_update_service import FamilyUpdateService
from app.services.notification_service import get_notification_service
from sqlmodel import Session, select

logger = logging.getLogger(__name__)


class FamilyUpdateScheduler:
    """Background task scheduler for sending periodic family updates."""

    def __init__(self, dev_mode: bool = True):
        self.dev_mode = dev_mode
        self.notification_service = get_notification_service(dev_mode=dev_mode)
        self.running = False

    def process_scheduled_updates(self):
        """Check and send any updates that are due.
        
        This method should be called periodically (e.g., every minute).
        """
        try:
            session = next(get_session())
            
            # Get all users with enabled family updates
            enabled_prefs = session.exec(
                select(FamilyUpdatePreference).where(
                    FamilyUpdatePreference.is_enabled == True,
                    FamilyUpdatePreference.has_given_consent == True
                )
            ).all()
            
            now = time.time()
            processed = 0
            sent = 0
            
            for prefs in enabled_prefs:
                # Check if it's time to send
                if prefs.next_scheduled_update is None or now >= prefs.next_scheduled_update:
                    try:
                        result = self._send_update_for_user(session, prefs)
                        sent += result
                        processed += 1
                    except Exception as e:
                        logger.error(f"Error sending update for user {prefs.user_id}: {e}")
            
            if processed > 0:
                logger.info(f"Processed {processed} scheduled updates, sent {sent} notifications")
            
            session.close()
            
        except Exception as e:
            logger.error(f"Error in process_scheduled_updates: {e}")

    def _send_update_for_user(self, session: Session, prefs: FamilyUpdatePreference) -> int:
        """Send an update for a specific user."""
        user_id = prefs.user_id
        
        # Get active contacts
        contacts = FamilyUpdateService.get_active_contacts(session, user_id)
        if not contacts:
            return 0
        
        # Generate report
        message = FamilyUpdateService.generate_status_report(session, user_id)
        
        # Send to each contact
        sent_count = 0
        for contact in contacts:
            recipient = contact.email if contact.preferred_method == "email" else contact.phone
            if not recipient:
                continue
            
            # Log the attempt
            history = FamilyUpdateService.log_update(
                session, user_id, contact.id,
                update_type="scheduled",
                message=message,
                status="pending"
            )
            
            # Send notification
            try:
                result = self.notification_service.send_notification(
                    contact.preferred_method,
                    recipient,
                    "Factech AI Family Update",
                    message
                )
                
                if result["success"]:
                    FamilyUpdateService.mark_delivered(session, history.id)
                    sent_count += 1
                else:
                    FamilyUpdateService.mark_failed(session, history.id, result.get("error", "Unknown error"))
            except Exception as e:
                FamilyUpdateService.mark_failed(session, history.id, str(e))
        
        # Update next scheduled time
        next_time = FamilyUpdateService.calculate_next_update_time(prefs.update_frequency)
        FamilyUpdateService.update_preferences(
            session, user_id,
            next_scheduled_update=next_time,
            last_update_sent=time.time()
        )
        
        logger.info(f"Sent {sent_count} updates for user {user_id}")
        return sent_count


# Global scheduler instance
_scheduler: FamilyUpdateScheduler | None = None


def get_scheduler(dev_mode: bool = True) -> FamilyUpdateScheduler:
    """Get or create the scheduler."""
    global _scheduler
    if _scheduler is None:
        _scheduler = FamilyUpdateScheduler(dev_mode=dev_mode)
    return _scheduler


def start_background_scheduler():
    """Start the background scheduler task.
    
    This should be called during app startup.
    In production, use APScheduler to run periodically.
    """
    logger.info("Family update scheduler initialized (will run via APScheduler)")
