"""Notificaciones operativas externas para Procura AI."""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any, Dict

import requests


TRUE_VALUES = {"1", "true", "yes", "si", "sí", "on"}


@dataclass(frozen=True)
class TelegramConfig:
    enabled: bool
    token: str
    chat_id: str

    @property
    def configured(self) -> bool:
        return bool(self.token and self.chat_id)


def telegram_config() -> TelegramConfig:
    return TelegramConfig(
        enabled=os.getenv("TELEGRAM_NOTIFICATIONS_ENABLED", "false").strip().lower() in TRUE_VALUES,
        token=os.getenv("TELEGRAM_BOT_TOKEN", "").strip(),
        chat_id=os.getenv("TELEGRAM_CHAT_ID", "").strip(),
    )


def telegram_status() -> Dict[str, Any]:
    config = telegram_config()
    return {
        "enabled": config.enabled,
        "configured": config.configured,
        "chat_configured": bool(config.chat_id),
        "token_configured": bool(config.token),
    }


def send_telegram_message(text: str, *, silent: bool = False) -> Dict[str, Any]:
    config = telegram_config()
    if not config.enabled:
        return {"ok": False, "skipped": True, "error": "Telegram esta desactivado."}
    if not config.configured:
        return {"ok": False, "skipped": True, "error": "Faltan TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID."}

    message = str(text or "").strip()
    if not message:
        return {"ok": False, "skipped": True, "error": "El mensaje esta vacio."}

    try:
        response = requests.post(
            f"https://api.telegram.org/bot{config.token}/sendMessage",
            json={
                "chat_id": config.chat_id,
                "text": message[:4096],
                "disable_notification": bool(silent),
                "disable_web_page_preview": True,
            },
            timeout=20,
        )
        data = response.json() if response.content else {}
        if response.ok and data.get("ok"):
            return {
                "ok": True,
                "message_id": (data.get("result") or {}).get("message_id"),
            }
        description = str(data.get("description") or f"Telegram respondio HTTP {response.status_code}")
        return {"ok": False, "error": description[:1000]}
    except requests.RequestException as exc:
        return {"ok": False, "error": f"No se pudo conectar con Telegram: {str(exc)[:800]}"}
    except ValueError:
        return {"ok": False, "error": "Telegram devolvio una respuesta no valida."}


def send_telegram_once(
    db_module,
    *,
    event_key: str,
    event_type: str,
    numero_licitacion: str,
    owner_username: str,
    text: str,
    payload: Dict[str, Any] | None = None,
) -> Dict[str, Any]:
    config = telegram_config()
    if not config.enabled or not config.configured:
        return {"ok": False, "skipped": True, "error": "Telegram no esta configurado y activo."}

    event_id = db_module.claim_notification_event(
        event_key,
        event_type,
        numero_licitacion,
        owner_username,
        payload or {},
    )
    if not event_id:
        return {"ok": True, "duplicate": True}

    result = send_telegram_message(text)
    db_module.complete_notification_event(event_id, bool(result.get("ok")), result.get("error", ""))
    return {**result, "event_id": event_id}
