import os
import unittest
from unittest.mock import patch

import pandas as pd

import api
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


class DeduplicatingDatabase:
    def __init__(self):
        self.claimed = set()
        self.completed = []

    def claim_notification_event(self, event_key, *_args, **_kwargs):
        if event_key in self.claimed:
            return None
        self.claimed.add(event_key)
        return len(self.claimed)

    def complete_notification_event(self, event_id, sent, error=""):
        self.completed.append((event_id, sent, error))


class TrackingDatabase:
    def __init__(self, record):
        source_records = record if isinstance(record, list) else [record]
        self.records = [dict(item) for item in source_records]
        self.snapshots = []
        self.status_updates = []

    def get_tracking_notification_candidates(self):
        return pd.DataFrame(self.records)

    def guardar_snapshot_sli(self, seguimiento_id, snapshot):
        self.snapshots.append((seguimiento_id, dict(snapshot)))
        for record in self.records:
            if int(record["seguimiento_id"]) == int(seguimiento_id):
                record["sli_snapshot_json"] = dict(snapshot)
        return {"id": seguimiento_id, "sli_checked_at": "2026-08-20 12:00:00"}

    def actualizar_estado(self, seguimiento_id, estado, nota, registrado_por):
        self.status_updates.append((seguimiento_id, estado, nota, registrado_por))


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

    def test_same_event_is_delivered_only_once(self):
        database = DeduplicatingDatabase()
        env = {
            "TELEGRAM_NOTIFICATIONS_ENABLED": "true",
            "TELEGRAM_BOT_TOKEN": "test-token",
            "TELEGRAM_CHAT_ID": "-123",
        }
        with patch.dict(os.environ, env, clear=False), patch("notifications.requests.post", return_value=FakeResponse()) as post:
            first = notifications.send_telegram_once(
                database,
                event_key="same-event",
                event_type="amendment",
                numero_licitacion="123456",
                owner_username="analista",
                text="Nueva enmienda",
            )
            second = notifications.send_telegram_once(
                database,
                event_key="same-event",
                event_type="amendment",
                numero_licitacion="123456",
                owner_username="analista",
                text="Nueva enmienda",
            )

        self.assertTrue(first["ok"])
        self.assertTrue(second["duplicate"])
        self.assertEqual(post.call_count, 1)


class TrackingNotificationFlowTests(unittest.TestCase):
    def setUp(self):
        self.base_record = {
            "seguimiento_id": 10,
            "numero_licitacion": "214148",
            "owner_username": "Gabrielrrp",
            "responsable": "Gabrielrrp",
            "seguimiento_objeto": "Bombas de diafragma",
            "radar_objeto": "Bombas de diafragma",
            "seguimiento_link_sli": "",
            "radar_link_sli": "https://apps.pancanal.com/sli/214148",
            "fecha_cierre": "31-dec-2099 10:00 AM",
            "numero_enmienda": "",
            "ultima_revision": "",
            "enmienda_alerta": False,
            "fecha_enmienda_alerta": "",
            "activo_portal": True,
            "fecha_salida_portal": "",
            "sli_snapshot_json": {},
        }

    @staticmethod
    def telegram_status():
        return {"enabled": True, "configured": True}

    def run_flow(self, database, deliveries):
        claimed = set()

        def send_once(_db, **kwargs):
            key = kwargs["event_key"]
            if key in claimed:
                return {"ok": True, "duplicate": True}
            claimed.add(key)
            deliveries.append(kwargs)
            return {"ok": True, "message_id": len(deliveries)}

        with patch.object(api, "db", database), \
             patch.object(api.notification_service, "telegram_status", side_effect=self.telegram_status), \
             patch.object(api.notification_service, "send_telegram_once", side_effect=send_once):
            first = api.process_tracking_notifications()
            second = api.process_tracking_notifications()
        return first, second

    def test_initial_sync_without_change_does_not_alert(self):
        database = TrackingDatabase(self.base_record)
        deliveries = []
        self.run_flow(database, deliveries)
        self.assertEqual(deliveries, [])
        self.assertEqual(len(database.snapshots), 2)

    def test_real_amendment_change_alerts_once(self):
        record = {
            **self.base_record,
            "numero_enmienda": "2",
            "enmienda_alerta": True,
            "fecha_enmienda_alerta": "2026-08-20 11:00:00",
            "sli_snapshot_json": {"numero_enmienda": "1", "fecha_cierre": "31-dec-2099 10:00 AM"},
        }
        database = TrackingDatabase(record)
        deliveries = []
        first, second = self.run_flow(database, deliveries)
        self.assertEqual(first["sent"], 1)
        self.assertEqual(second["sent"], 0)
        self.assertEqual(len(deliveries), 1)
        self.assertIn("Dirigida a: Gabrielrrp", deliveries[0]["text"])

    def test_real_close_change_alerts_once(self):
        record = {
            **self.base_record,
            "sli_snapshot_json": {"fecha_cierre": "30-dec-2099 10:00 AM"},
        }
        database = TrackingDatabase(record)
        deliveries = []
        first, second = self.run_flow(database, deliveries)
        self.assertEqual(first["sent"], 1)
        self.assertEqual(second["sent"], 0)
        self.assertEqual(len(deliveries), 1)
        self.assertEqual(deliveries[0]["event_type"], "close_changed")

    def test_revision_change_is_not_hidden_by_same_amendment_number(self):
        record = {
            **self.base_record,
            "numero_enmienda": "2",
            "ultima_revision": "rev-b",
            "enmienda_alerta": True,
            "fecha_enmienda_alerta": "2026-08-20 13:00:00",
            "sli_snapshot_json": {
                "numero_enmienda": "2",
                "ultima_revision": "rev-a",
                "fecha_cierre": "31-dec-2099 10:00 AM",
            },
        }
        database = TrackingDatabase(record)
        deliveries = []
        first, second = self.run_flow(database, deliveries)
        expected_key = api._notification_event_key(
            "telegram",
            "214148",
            "amendment",
            "enmienda=2|revision=rev-b|detectado=2026-08-20 13:00:00",
        )
        self.assertEqual(first["sent"], 1)
        self.assertEqual(second["sent"], 0)
        self.assertEqual(len(deliveries), 1)
        self.assertEqual(deliveries[0]["event_key"], expected_key)


class SliStatusMonitorTests(unittest.TestCase):
    def setUp(self):
        self.record = {
            "seguimiento_id": 31,
            "numero_licitacion": "214148",
            "owner_username": "Gabrielrrp",
            "responsable": "Gabrielrrp",
            "seguimiento_objeto": "Bombas de diafragma",
            "seguimiento_estado": "ABIERTA",
            "seguimiento_link_sli": "https://apps.pancanal.com/sli/214148",
            "radar_link_sli": "",
            "sli_snapshot_json": {"estado_acp": {"code": "ABIERTAS", "label": "Abiertas"}},
        }

    def test_normalizes_all_official_acp_statuses(self):
        expected = {
            "ABIERTAS": "ABIERTAS",
            "ANUNCIO VENCIDO": "ANUNCIO_VENCIDO",
            "CANCELACIÓN DEL ACTO": "CANCELACION_DEL_ACTO",
            "EVALUACIÓN": "EVALUACION",
            "ENMENDADA": "ENMENDADA",
            "ACTO DESIERTO": "ACTO_DESIERTO",
            "ADJUDICACIÓN": "ADJUDICACION",
            "PRECALIFICACIÓN CONCLUIDA": "PRECALIFICACION_CONCLUIDA",
        }
        for raw, code in expected.items():
            self.assertEqual(api._normalize_sli_status(raw)["code"], code)

    def test_award_requires_explicit_evidence(self):
        confirmed = api._extract_award_result("Se adjudica la licitación a ABC Industrial LLC por USD 18,450.00.")
        uncertain = api._extract_award_result("Se recibieron propuestas de ABC Industrial LLC y otros proveedores.")
        self.assertTrue(confirmed["confirmada"])
        self.assertEqual(confirmed["empresa_adjudicada"], "ABC Industrial LLC")
        self.assertEqual(confirmed["monto_adjudicado"], "USD 18,450.00")
        self.assertFalse(uncertain["confirmada"])

    def test_evaluation_transition_sends_once_and_updates_status(self):
        database = TrackingDatabase(self.record)
        deliveries = []
        claimed = set()

        def send_once(_db, **kwargs):
            if kwargs["event_key"] in claimed:
                return {"ok": True, "duplicate": True}
            claimed.add(kwargs["event_key"])
            deliveries.append(kwargs)
            return {"ok": True}

        result = {
            "rfq_id": "214148",
            "url": "https://apps.pancanal.com/sli/214148",
            "estatus": "EVALUACIÓN",
            "estado_acp": api._normalize_sli_status("EVALUACIÓN"),
            "fecha_cierre": "31-dec-2099 10:00 AM",
            "adjudicacion": {},
        }
        with patch.object(api, "db", database), patch.object(api.notification_service, "send_telegram_once", side_effect=send_once):
            first = api._apply_tracked_sli_result("214148", database.records, result, persist=True)
            second = api._apply_tracked_sli_result("214148", database.records, result, persist=True)

        self.assertEqual(first["sent"], 1)
        self.assertEqual(second["sent"], 0)
        self.assertEqual(len(deliveries), 1)
        self.assertIn("Evaluación", deliveries[0]["text"])
        self.assertEqual(database.status_updates[0][1], "En Evaluacion ACP")

    def test_adjudication_message_includes_confirmed_company(self):
        database = TrackingDatabase({
            **self.record,
            "sli_snapshot_json": {"estado_acp": {"code": "EVALUACION", "label": "Evaluación"}},
            "seguimiento_estado": "En Evaluacion ACP",
        })
        deliveries = []

        def send_once(_db, **kwargs):
            deliveries.append(kwargs)
            return {"ok": True}

        result = {
            "rfq_id": "214148",
            "url": "https://apps.pancanal.com/sli/214148",
            "estatus": "ADJUDICACIÓN",
            "estado_acp": api._normalize_sli_status("ADJUDICACIÓN"),
            "adjudicacion": {
                "confirmada": True,
                "empresa_adjudicada": "ABC Industrial LLC",
                "monto_adjudicado": "USD 18,450.00",
                "evidencia": "Se adjudica la licitación a ABC Industrial LLC.",
            },
        }
        with patch.object(api, "db", database), patch.object(api.notification_service, "send_telegram_once", side_effect=send_once):
            stats = api._apply_tracked_sli_result("214148", database.records, result, persist=True)

        self.assertEqual(stats["sent"], 1)
        self.assertEqual(len(deliveries), 1)
        self.assertIn("Empresa adjudicada: ABC Industrial LLC", deliveries[0]["text"])

    def test_uses_most_recent_snapshot_when_multiple_users_follow_same_tender(self):
        database = TrackingDatabase([
            {
                **self.record,
                "seguimiento_id": 31,
                "sli_checked_at": "2026-09-01 08:00:00",
                "sli_snapshot_json": {"estado_acp": {"code": "EVALUACION", "label": "Evaluación"}},
            },
            {
                **self.record,
                "seguimiento_id": 32,
                "owner_username": "Maria",
                "sli_checked_at": "2026-09-01 09:00:00",
                "sli_snapshot_json": {"estado_acp": {"code": "ADJUDICACION", "label": "Adjudicación"}},
            },
        ])
        deliveries = []
        result = {
            "rfq_id": "214148",
            "url": "https://apps.pancanal.com/sli/214148",
            "estatus": "ADJUDICACIÓN",
            "estado_acp": api._normalize_sli_status("ADJUDICACIÓN"),
            "adjudicacion": {},
        }

        with patch.object(api, "db", database), patch.object(
            api.notification_service, "send_telegram_once", side_effect=lambda *_args, **kwargs: deliveries.append(kwargs) or {"ok": True}
        ):
            stats = api._apply_tracked_sli_result("214148", database.records, result, persist=True)

        self.assertEqual(stats["sent"], 0)
        self.assertEqual(deliveries, [])


class RadarScanIsolationTests(unittest.TestCase):
    def test_direct_tracking_continues_when_open_radar_scan_fails(self):
        tracking_result = {"checked": 2, "sent": 1, "duplicates": 0, "errors": 0, "updated": 1}

        with patch("sli_scraper.ejecutar_radar_detallado", side_effect=RuntimeError("SLI temporalmente no disponible")), patch.object(
            api, "sync_tracked_tenders_from_sli", return_value=tracking_result
        ) as sync, patch.object(api, "process_tracking_notifications") as notifications_flow:
            result = api.run_radar_auto_scan(source="test")

        self.assertEqual(result["status"], "partial")
        self.assertEqual(result["result"]["seguimiento_sli"], tracking_result)
        self.assertTrue(result["result"]["notifications"]["skipped"])
        sync.assert_called_once()
        notifications_flow.assert_not_called()


if __name__ == "__main__":
    unittest.main()
