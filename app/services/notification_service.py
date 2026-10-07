"""Notification service abstraction — pluggable providers."""
import sys
from abc import ABC, abstractmethod
from datetime import datetime
from typing import Dict, Optional


class NotificationProvider(ABC):
    """Base class for notification providers."""

    @abstractmethod
    def is_configured(self) -> bool:
        """Check if provider is properly configured."""
        pass

    @abstractmethod
    def send(self, recipient: str, subject: str, message: str) -> Dict:
        """Send a notification.
        
        Returns:
            {
                "success": bool,
                "message_id": str (optional),
                "error": str (optional)
            }
        """
        pass


class DevTestProvider(NotificationProvider):
    """Development/test provider that logs to console instead of sending."""

    def __init__(self):
        self.sent_messages = []  # For testing

    def is_configured(self) -> bool:
        return True

    def send(self, recipient: str, subject: str, message: str) -> Dict:
        """Log the message to console."""
        timestamp = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S UTC")
        log_entry = f"""
[DEV/TEST NOTIFICATION - {timestamp}]
To: {recipient}
Subject: {subject}
---
{message}
---
"""
        print(log_entry, flush=True)
        sys.stderr.write(log_entry + "\n")
        sys.stderr.flush()

        msg_id = f"dev_{len(self.sent_messages)}"
        self.sent_messages.append({
            "id": msg_id,
            "recipient": recipient,
            "subject": subject,
            "timestamp": timestamp,
            "method": "dev_test"
        })
        
        return {
            "success": True,
            "message_id": msg_id
        }


class EmailProvider(NotificationProvider):
    """Email notification provider."""

    def __init__(self, smtp_server: str = "localhost", smtp_port: int = 587,
                 from_email: str = "noreply@factech.ai", username: str = "",
                 password: str = ""):
        self.smtp_server = smtp_server
        self.smtp_port = smtp_port
        self.from_email = from_email
        self.username = username
        self.password = password

    def is_configured(self) -> bool:
        """Check minimal configuration."""
        return bool(self.smtp_server and self.from_email)

    def send(self, recipient: str, subject: str, message: str) -> Dict:
        """Send an email.
        
        NOTE: In production, implement with smtplib or sendgrid.
        For now, this is a stub that returns success for dev/test.
        """
        try:
            # Stub implementation - would use smtplib in production
            # import smtplib
            # from email.mime.text import MIMEText
            # from email.mime.multipart import MIMEMultipart
            
            # msg = MIMEMultipart()
            # msg["From"] = self.from_email
            # msg["To"] = recipient
            # msg["Subject"] = subject
            # msg.attach(MIMEText(message, "plain"))
            
            # with smtplib.SMTP(self.smtp_server, self.smtp_port) as server:
            #     server.starttls()
            #     if self.username and self.password:
            #         server.login(self.username, self.password)
            #     server.send_message(msg)
            
            msg_id = f"email_{hash(recipient + str(datetime.utcnow()))}"
            return {
                "success": True,
                "message_id": msg_id
            }
        except Exception as e:
            return {
                "success": False,
                "error": str(e)
            }


class SMSProvider(NotificationProvider):
    """SMS notification provider (stub)."""

    def __init__(self, api_key: str = ""):
        self.api_key = api_key

    def is_configured(self) -> bool:
        """Check if API key is set."""
        return bool(self.api_key)

    def send(self, recipient: str, subject: str, message: str) -> Dict:
        """Send an SMS.
        
        NOTE: In production, use Twilio, AWS SNS, or similar.
        """
        try:
            # Stub implementation
            # In production: send via Twilio, AWS SNS, etc.
            msg_id = f"sms_{hash(recipient + str(datetime.utcnow()))}"
            return {
                "success": True,
                "message_id": msg_id
            }
        except Exception as e:
            return {
                "success": False,
                "error": str(e)
            }


class WhatsAppProvider(NotificationProvider):
    """WhatsApp Business API provider (stub)."""

    def __init__(self, api_key: str = "", phone_number_id: str = ""):
        self.api_key = api_key
        self.phone_number_id = phone_number_id

    def is_configured(self) -> bool:
        """Check if credentials are set."""
        return bool(self.api_key and self.phone_number_id)

    def send(self, recipient: str, subject: str, message: str) -> Dict:
        """Send via WhatsApp Business API.
        
        NOTE: In production, use official Meta WhatsApp Business API only.
        Never use unofficial/scraping methods.
        """
        try:
            # Stub implementation
            # In production: use requests to send via meta.com/official API
            msg_id = f"whatsapp_{hash(recipient + str(datetime.utcnow()))}"
            return {
                "success": True,
                "message_id": msg_id
            }
        except Exception as e:
            return {
                "success": False,
                "error": str(e)
            }


class NotificationService:
    """Notification service with pluggable providers."""

    def __init__(self, dev_mode: bool = True):
        self.dev_mode = dev_mode
        self.providers: Dict[str, NotificationProvider] = {}
        
        # Always have dev provider available
        self.providers["dev_test"] = DevTestProvider()
        
        # Add other providers (stub configs for now)
        self.providers["email"] = EmailProvider()
        self.providers["sms"] = SMSProvider()
        self.providers["whatsapp"] = WhatsAppProvider()

    def send_notification(self, method: str, recipient: str, subject: str, message: str) -> Dict:
        """Send a notification via the specified method.
        
        In dev mode, always use dev_test provider.
        """
        if self.dev_mode:
            provider = self.providers["dev_test"]
        else:
            provider = self.providers.get(method, self.providers["dev_test"])
        
        if not provider.is_configured():
            return {
                "success": False,
                "error": f"Provider {method} not configured"
            }
        
        return provider.send(recipient, subject, message)

    def is_provider_configured(self, method: str) -> bool:
        """Check if a provider is configured."""
        provider = self.providers.get(method)
        return provider.is_configured() if provider else False

    def get_configured_methods(self) -> list:
        """Get list of configured notification methods."""
        return [method for method, provider in self.providers.items() if provider.is_configured()]


# Global notification service instance
_notification_service: Optional[NotificationService] = None


def get_notification_service(dev_mode: bool = True) -> NotificationService:
    """Get or create the notification service."""
    global _notification_service
    if _notification_service is None:
        _notification_service = NotificationService(dev_mode=dev_mode)
    return _notification_service
