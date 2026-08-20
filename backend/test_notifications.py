import os
import unittest
from unittest.mock import patch

import notifications


class FakeResponse:
    ok = True
    content = b"{}"
    status_code = 200

    def json(self):
        return {"ok": True, "result": {"message_id": 42}}


class FakeDatabase:
    def __init__(self):
        self.completed = []

    def claim_notification_event(self, *_args, **_kwargs):
        return 7

    def complete_notification_event(self, event_id, sent, error=""):
        self.completed.append((event_id, sent, error))


class TelegramNotificationTests(unittest.TestCase):
    def test_disabled_service_skips_without_network(self):
        with patch.dict(os.environ, {"TELEGRAM_NOTIFICATIONS_ENABLED": "false"}, clear=False):
            result = notifications.send_telegram_message("Prueba")
        self.assertTrue(result["skipped"])

    def test_successful_delivery_marks_event_sent(self):
        database = FakeDatabase()
        env = {
            "TELEGRAM_NOTIFICATIONS_ENABLED": "true",
            "TELEGRAM_BOT_TOKEN": "test-token",
            "TELEGRAM_CHAT_ID": "-123",
        }
        with patch.dict(os.environ, env, clear=False), patch("notifications.requests.post", return_value=FakeResponse()):
            result = notifications.send_telegram_once(
                database,
                event_key="event-key",
                event_type="amendment",
                numero_licitacion="123456",
                owner_username="analista",
                text="Nueva enmienda",
            )
        self.assertTrue(result["ok"])
        self.assertEqual(database.completed, [(7, True, "")])


if __name__ == "__main__":
    unittest.main()
