from fastapi import FastAPI, UploadFile, File, HTTPException, Form, BackgroundTasks, Header, Depends, Query
from fastapi.middleware.cors import CORSMiddleware
from typing import Any, Dict, List, Optional
from pydantic import BaseModel
import tempfile
import os
try:
    import truststore
    truststore.inject_into_ssl()
except Exception:
    pass
try:
    import certifi
    CERTIFI_CA_BUNDLE = certifi.where()
    os.environ.setdefault("SSL_CERT_FILE", CERTIFI_CA_BUNDLE)
    os.environ.setdefault("REQUESTS_CA_BUNDLE", CERTIFI_CA_BUNDLE)
    os.environ.setdefault("GRPC_DEFAULT_SSL_ROOTS_FILE_PATH", CERTIFI_CA_BUNDLE)
except Exception:
    pass
import json
import imaplib
import email
from email.header import decode_header
import re
import shutil
import hashlib
import base64
import hmac
import time
import threading
from concurrent.futures import ThreadPoolExecutor
import unicodedata
import socket
import ssl
from datetime import datetime
import pandas as pd
import io
import zipfile
import xml.etree.ElementTree as ET
from urllib.parse import urljoin, urlparse
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from dotenv import load_dotenv
from decimal import Decimal, InvalidOperation
import uuid
import requests
import database as db
import logging
from logging.handlers import RotatingFileHandler
from bs4 import BeautifulSoup
import sys
import asyncio
import crypto
import notifications as notification_service

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
load_dotenv()

GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash-lite")
GEMINI_FALLBACK_MODELS = [
    model.strip()
    for model in os.getenv("GEMINI_FALLBACK_MODELS", "gemini-2.5-flash").split(",")
    if model.strip()
]
FRONTEND_ORIGIN = os.getenv("FRONTEND_ORIGIN", "").strip().rstrip("/")

def gemini_model_candidates():
    models = [GEMINI_MODEL, *GEMINI_FALLBACK_MODELS]
    unique = []
    for model in models:
        if model and model not in unique:
            unique.append(model)
    return unique

def is_retryable_gemini_error(exc):
    text = str(exc or "").lower()
    return any(
        marker in text
        for marker in [
            "503",
            "unavailable",
            "high demand",
            "temporarily",
            "overloaded",
            "resource exhausted",
        ]
    )

def get_gemini_client(api_key):
    from google import genai
    return genai.Client(api_key=str(api_key or "").strip())

def gemini_generate_with_fallback(client, contents, response_mime_type=None):
    from google.genai import types

    config = None
    if response_mime_type:
        config = types.GenerateContentConfig(response_mime_type=response_mime_type)
    last_error = None
    for idx, model in enumerate(gemini_model_candidates()):
        kwargs = {"model": model, "contents": contents}
        if config:
            kwargs["config"] = config
        try:
            response = client.models.generate_content(**kwargs)
            return response, model
        except Exception as exc:
            last_error = exc
            if not is_retryable_gemini_error(exc) or idx == len(gemini_model_candidates()) - 1:
                raise
            logger.warning(f"Gemini modelo {model} no disponible temporalmente. Intentando fallback.")
            time.sleep(1 + idx)
    raise last_error

def gemini_generate_content(api_key, contents, response_mime_type=None):
    client = get_gemini_client(api_key)
    response, _ = gemini_generate_with_fallback(client, contents, response_mime_type=response_mime_type)
    return response

def gemini_upload_file(client, path):
    return client.files.upload(file=os.path.abspath(path))

RUNTIME_UPLOAD_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".runtime_uploads")
os.makedirs(RUNTIME_UPLOAD_DIR, exist_ok=True)

def is_windows_network_filter_error(exc):
    text = str(exc)
    return (
        "Permission denied" in text
        and ("nllMonFltProxy" in text or "\\\\.\\" in text or "Connection aborted" in text)
    )

def user_friendly_external_error(exc, context="servicio externo"):
    if is_windows_network_filter_error(exc):
        return (
            f"Windows o la red corporativa bloqueo la conexion con {context}. "
            "Cierra VPN/proxy si aplica, vuelve a intentar, o prueba reiniciar la API. "
            "Detalle tecnico: Permission denied en filtro de red local."
        )
    return str(exc)

async def save_upload_to_runtime_file(upload_file, suffix=".pdf", validate_pdf=False):
    safe_suffix = suffix if suffix.startswith(".") and len(suffix) <= 12 else ".bin"
    with tempfile.NamedTemporaryFile(delete=False, suffix=safe_suffix, dir=RUNTIME_UPLOAD_DIR) as tmp:
        content = await upload_file.read()
        if validate_pdf and content[:4] != b"%PDF":
            raise ValueError(f"El archivo {upload_file.filename or 'sin nombre'} no parece ser un PDF valido.")
        tmp.write(content)
        return tmp.name

def extract_pdf_pages_from_path(path, max_pages=80, max_chars_per_page=24000):
    """Extrae texto local para validar hechos que Gemini no debe inferir."""
    try:
        from pypdf import PdfReader

        reader = PdfReader(path)
        pages = []
        for page_number, pdf_page in enumerate(reader.pages[:max_pages], start=1):
            extracted = (pdf_page.extract_text() or "").strip()
            if extracted:
                pages.append({
                    "pagina": page_number,
                    "texto": extracted[:max_chars_per_page],
                })
        return pages
    except Exception as exc:
        logger.warning(f"No se pudo extraer texto local del PDF {path}: {exc}")
        return []

def safe_remove_file(path):
    try:
        if path and os.path.exists(path):
            os.remove(path)
    except Exception as exc:
        logger.warning(f"No se pudo borrar temporal local {path}: {exc}")

def gemini_delete_file(client, uploaded_file):
    try:
        file_name = getattr(uploaded_file, "name", None)
        if file_name:
            client.files.delete(name=file_name)
    except Exception as e:
        logger.warning(f"No se pudo borrar archivo temporal de Gemini: {e}")

# --- 1. LOGGING CON ROTACIÓN (max 2MB, 3 backups) ---
log_handler = RotatingFileHandler('backend.log', maxBytes=2*1024*1024, backupCount=3, encoding='utf-8')
log_handler.setFormatter(logging.Formatter('%(asctime)s - %(levelname)s - %(message)s'))
logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)
logger.addHandler(log_handler)

# --- 2. SEGURIDAD Y CIFRADO ---
# Se utiliza el módulo centralizado `crypto.py`
INTERNAL_API_TOKEN = os.getenv("INTERNAL_API_TOKEN", "default-dev-token")
SESSION_TTL_SECONDS = max(3600, int(os.getenv("SESSION_TTL_SECONDS", "86400") or 86400))
RADAR_AUTO_SCAN_ENABLED = os.getenv("RADAR_AUTO_SCAN_ENABLED", "true").strip().lower() in ["1", "true", "yes", "si", "sí", "on"]
RADAR_AUTO_SCAN_INTERVAL_MINUTES = max(5, int(os.getenv("RADAR_AUTO_SCAN_INTERVAL_MINUTES", "25") or 25))
RADAR_AUTO_SCAN_ON_STARTUP = os.getenv("RADAR_AUTO_SCAN_ON_STARTUP", "true").strip().lower() in ["1", "true", "yes", "si", "sí", "on"]
RADAR_SCHEDULER_STATE = {
    "enabled": RADAR_AUTO_SCAN_ENABLED,
    "interval_minutes": RADAR_AUTO_SCAN_INTERVAL_MINUTES,
    "running": False,
    "last_started": None,
    "last_finished": None,
    "last_result": None,
    "last_error": None,
    "next_run_at": None,
}
_radar_scheduler_stop = threading.Event()
_radar_scan_lock = threading.Lock()
_radar_scheduler_thread = None

def _notification_event_key(*parts):
    raw = "|".join(str(part or "").strip().lower() for part in parts)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _tracking_snapshot(value):
    if isinstance(value, dict):
        return dict(value)
    try:
        return json.loads(value) if value else {}
    except (TypeError, ValueError, json.JSONDecodeError):
        return {}


def _fold_sli_text(value: Any) -> str:
    raw = str(value or "").strip()
    return "".join(
        char for char in unicodedata.normalize("NFD", raw.upper())
        if unicodedata.category(char) != "Mn"
    )


SLI_STATUS_DEFINITIONS = {
    "ABIERTAS": {"label": "Abiertas", "final": False, "stage": "open"},
    "ANUNCIO_VENCIDO": {"label": "Anuncio vencido", "final": False, "stage": "pending_result"},
    "CANCELACION_DEL_ACTO": {"label": "Cancelación del acto", "final": True, "stage": "cancelled"},
    "EVALUACION": {"label": "Evaluación", "final": False, "stage": "evaluation"},
    "ENMENDADA": {"label": "Enmendada", "final": False, "stage": "amended"},
    "ACTO_DESIERTO": {"label": "Acto desierto", "final": True, "stage": "deserted"},
    "ADJUDICACION": {"label": "Adjudicación", "final": True, "stage": "award"},
    "PRECALIFICACION_CONCLUIDA": {"label": "Precalificación concluida", "final": False, "stage": "prequalification"},
}


def _normalize_sli_status(value: Any) -> Dict[str, Any]:
    text = _fold_sli_text(value)
    checks = [
        ("CANCELACION DEL ACTO", "CANCELACION_DEL_ACTO"),
        ("ACTO DESIERTO", "ACTO_DESIERTO"),
        ("PRECALIFICACION CONCLUIDA", "PRECALIFICACION_CONCLUIDA"),
        ("ANUNCIO VENCIDO", "ANUNCIO_VENCIDO"),
        ("ADJUDICACION", "ADJUDICACION"),
        ("EVALUACION", "EVALUACION"),
        ("ENMENDADA", "ENMENDADA"),
        ("ABIERT", "ABIERTAS"),
    ]
    for marker, code in checks:
        if marker in text:
            return {"code": code, **SLI_STATUS_DEFINITIONS[code]}
    return {"code": "DESCONOCIDO", "label": str(value or "No identificado").strip() or "No identificado", "final": False, "stage": "unknown"}


def _clean_award_company(value: str) -> str:
    candidate = re.sub(r"\s+", " ", str(value or "")).strip(" .,:;|-\t\r\n")
    candidate = re.sub(r"^(?:a\s+)?(?:la\s+)?(?:empresa|sociedad|firma|proveedor|proponente)\s+", "", candidate, flags=re.IGNORECASE)
    candidate = re.split(r"\s+(?:por|para|conforme|seg[uú]n|mediante)\s+", candidate, maxsplit=1, flags=re.IGNORECASE)[0]
    if len(candidate) < 3 or len(candidate) > 180:
        return ""
    if _fold_sli_text(candidate) in {"LA EMPRESA", "EL PROVEEDOR", "EL PROPONENTE", "N/A", "NO APLICA"}:
        return ""
    return candidate


def _extract_award_result(texto_acta: str) -> Dict[str, Any]:
    """Extrae solo adjudicaciones explicitamente respaldadas por un acta o resultado SLI."""
    source = re.sub(r"\s+", " ", str(texto_acta or "")).strip()
    empty = {
        "confirmada": False,
        "empresa_adjudicada": "",
        "monto_adjudicado": "",
        "moneda": "",
        "evidencia": "",
        "es_propia": False,
    }
    if not source:
        return empty

    patterns = [
        r"(?:empresa|proveedor|proponente|contratista)\s+(?:adjudicad[oa]|ganador(?:a)?|seleccionad[oa])\s*[:\-]\s*([^\n.;]{3,180})",
        r"(?:se\s+)?adjudica(?:\s+(?:la|el)\s+(?:licitaci[oó]n|contrato|acto|proceso|rengl[oó]n|orden(?:\s+de\s+compra)?))?\s+(?:a|al)\s+([^\n.;]{3,180})",
    ]
    for pattern in patterns:
        match = re.search(pattern, source, flags=re.IGNORECASE)
        if not match:
            continue
        company = _clean_award_company(match.group(1))
        if not company:
            continue
        start = max(0, match.start() - 120)
        end = min(len(source), match.end() + 180)
        evidence = source[start:end].strip()
        amount_match = re.search(r"(?:USD|US\$|B/\.|PAB|\$)\s*[\d]{1,3}(?:[,.][\d]{3})*(?:[,.]\d{2})?", evidence, flags=re.IGNORECASE)
        amount = amount_match.group(0) if amount_match else ""
        currency = ""
        amount_upper = amount.upper()
        if "USD" in amount_upper or "US$" in amount_upper or "$" in amount_upper:
            currency = "USD"
        elif "B/." in amount_upper or "PAB" in amount_upper:
            currency = "PAB"
        company_folded = _fold_sli_text(company)
        return {
            "confirmada": True,
            "empresa_adjudicada": company,
            "monto_adjudicado": amount,
            "moneda": currency,
            "evidencia": evidence[:650],
            "es_propia": "PROYELEC" in company_folded or "EP INTERNATIONAL" in company_folded,
        }
    return empty


def _notification_bool(value, default=True):
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in {"1", "true", "yes", "si", "sí", "on"}


def _telegram_close_hours():
    values = []
    for raw in os.getenv("TELEGRAM_CLOSE_ALERT_HOURS", "72,24,1").split(","):
        try:
            value = int(raw.strip())
            if value > 0:
                values.append(value)
        except ValueError:
            continue
    return sorted(set(values), reverse=True) or [72, 24, 1]


def _close_alert_bucket(fecha_cierre):
    if not fecha_cierre:
        return None
    try:
        from sli_scraper import parse_sli_datetime
        close_at = parse_sli_datetime(fecha_cierre)
        if not close_at:
            return None
        if close_at.tzinfo:
            close_at = close_at.replace(tzinfo=None)
        remaining_hours = (close_at - datetime.now()).total_seconds() / 3600
        if remaining_hours < 0:
            return None
        eligible = [hours for hours in _telegram_close_hours() if remaining_hours <= hours]
        return min(eligible) if eligible else None
    except Exception:
        return None


def process_tracking_notifications():
    status = notification_service.telegram_status()
    if not status.get("enabled") or not status.get("configured"):
        return {**status, "sent": 0, "errors": 0}

    candidates = db.get_tracking_notification_candidates()
    if candidates is None or candidates.empty:
        return {**status, "sent": 0, "errors": 0}

    stats = {**status, "sent": 0, "duplicates": 0, "errors": 0}
    grouped = {}
    for record in candidates.to_dict(orient="records"):
        numero = "".join(filter(str.isdigit, str(record.get("numero_licitacion") or "")))
        if numero:
            grouped.setdefault(numero, []).append(record)

    def deliver(numero, rows, event_type, event_value, text, payload):
        owners = sorted({
            str(row.get("owner_username") or row.get("responsable") or "").strip()
            for row in rows
            if str(row.get("owner_username") or row.get("responsable") or "").strip()
        })
        result = notification_service.send_telegram_once(
            db,
            event_key=_notification_event_key("telegram", numero, event_type, event_value),
            event_type=event_type,
            numero_licitacion=numero,
            owner_username=", ".join(owners),
            text=text,
            payload=payload,
        )
        if result.get("duplicate"):
            stats["duplicates"] += 1
        elif result.get("ok"):
            stats["sent"] += 1
        elif not result.get("skipped"):
            stats["errors"] += 1
            logger.warning(f"[TELEGRAM] Fallo evento {event_type} RFQ {numero}: {result.get('error')}")
        return bool(result.get("ok"))

    for numero, rows in grouped.items():
        row = rows[0]
        objeto = str(row.get("seguimiento_objeto") or row.get("radar_objeto") or "Sin nombre registrado").strip()
        owners = sorted({str(item.get("owner_username") or item.get("responsable") or "").strip() for item in rows if str(item.get("owner_username") or item.get("responsable") or "").strip()})
        destinatarios = ", ".join(owners) or "Equipo de Procura"
        cierre = str(row.get("fecha_cierre") or "").strip()
        enmienda = str(row.get("numero_enmienda") or "").strip()
        revision = str(row.get("ultima_revision") or "").strip()
        link = str(row.get("radar_link_sli") or row.get("seguimiento_link_sli") or f"https://apps.pancanal.com/sli/Licitaciones/LicitacionHeader?rfqId={numero}").strip()
        active = _notification_bool(row.get("activo_portal"), default=True)
        amendment_flag = _notification_bool(row.get("enmienda_alerta"), default=False)
        snapshots = [_tracking_snapshot(item.get("sli_snapshot_json")) for item in rows]
        previous = next((snapshot for snapshot in snapshots if snapshot), {})
        previous_amendments = [str(snapshot.get("numero_enmienda") or "").strip() for snapshot in snapshots if snapshot]
        previous_revisions = [str(snapshot.get("ultima_revision") or "").strip() for snapshot in snapshots if snapshot]
        previous_closes = [str(snapshot.get("fecha_cierre") or "").strip() for snapshot in snapshots if snapshot]
        previous_amendment = next((value for value in previous_amendments if value and value != enmienda), "") or str(previous.get("numero_enmienda") or "").strip()
        previous_revision = next((value for value in previous_revisions if value and value != revision), "") or str(previous.get("ultima_revision") or "").strip()
        previous_close = next((value for value in previous_closes if value and value != cierre), "") or str(previous.get("fecha_cierre") or "").strip()
        transitions_ok = True

        amendment_changed = bool(
            amendment_flag
            or (enmienda and previous_amendment and enmienda != previous_amendment)
            or (revision and previous_revision and revision != previous_revision)
        )
        if amendment_changed:
            detected_at = str(row.get("fecha_enmienda_alerta") or "").strip()
            value = f"enmienda={enmienda}|revision={revision}|detectado={detected_at}"
            text = "\n".join([
                "NUEVA ENMIENDA O REVISION", "", f"Licitacion: {numero}", f"Objeto: {objeto}",
                f"Cambio: {previous_amendment or previous_revision or 'version anterior'} -> {enmienda or revision or 'nueva revision'}",
                f"Cierre: {cierre or 'No especificado'}", f"Dirigida a: {destinatarios}", "", f"Revisar SLI: {link}",
            ])
            transitions_ok = deliver(numero, rows, "amendment", value, text, {"enmienda": enmienda, "revision": revision, "detectado": detected_at, "cierre": cierre}) and transitions_ok

        if previous_close and cierre and previous_close != cierre:
            text = "\n".join([
                "CAMBIO DE FECHA DE CIERRE", "", f"Licitacion: {numero}", f"Objeto: {objeto}",
                f"Cierre anterior: {previous_close}", f"Nuevo cierre: {cierre}",
                f"Dirigida a: {destinatarios}", "", f"Revisar SLI: {link}",
            ])
            transitions_ok = deliver(numero, rows, "close_changed", f"{previous_close}->{cierre}", text, {"anterior": previous_close, "nuevo": cierre}) and transitions_ok

        if not active:
            left_at = str(row.get("fecha_salida_portal") or "sin_fecha").strip()
            text = "\n".join([
                "PROCESO FUERA DEL LISTADO DE ABIERTAS", "", f"Licitacion: {numero}", f"Objeto: {objeto}",
                "El proceso ya no aparece entre las licitaciones abiertas.",
                "Verifica en el SLI si cerro, fue cancelado o cambio de estado.",
                f"Dirigida a: {destinatarios}", "", f"Revisar SLI: {link}",
            ])
            deliver(numero, rows, "left_open_list", left_at, text, {"fecha_salida": left_at})

        close_bucket = _close_alert_bucket(cierre)
        if active and close_bucket:
            text = "\n".join([
                f"CIERRE PROXIMO: {close_bucket} HORA(S)", "", f"Licitacion: {numero}", f"Objeto: {objeto}",
                f"Fecha de cierre: {cierre}", f"Dirigida a: {destinatarios}", "", f"Revisar SLI: {link}",
            ])
            deliver(numero, rows, "close_warning", f"{cierre}|{close_bucket}", text, {"cierre": cierre, "horas": close_bucket})

        if transitions_ok and active:
            for item, snapshot in zip(rows, snapshots):
                merged = {
                    **snapshot,
                    "rfq_id": numero,
                    "url": link,
                    "descripcion": str(item.get("radar_objeto") or objeto),
                    "fecha_cierre": cierre or snapshot.get("fecha_cierre"),
                    "numero_enmienda": enmienda,
                    "ultima_revision": revision,
                }
                db.guardar_snapshot_sli(int(item["seguimiento_id"]), merged)

    return stats


def _snapshot_acp_status(snapshot: Dict[str, Any]) -> Dict[str, Any]:
    state = snapshot.get("estado_acp") if isinstance(snapshot, dict) else None
    if isinstance(state, dict) and state.get("code"):
        return state
    return _normalize_sli_status((snapshot or {}).get("estatus"))


def _tracking_internal_status(state_code: str) -> str:
    return {
        "EVALUACION": "En Evaluacion ACP",
        "ANUNCIO_VENCIDO": "Pendiente de resultado",
        "ADJUDICACION": "Adjudicacion publicada",
        "ACTO_DESIERTO": "Desierta",
        "CANCELACION_DEL_ACTO": "Cancelada",
        "PRECALIFICACION_CONCLUIDA": "Precalificacion concluida",
    }.get(state_code, "")


def _tracking_recipients(rows: List[Dict[str, Any]]) -> str:
    owners = sorted({
        str(row.get("owner_username") or row.get("responsable") or "").strip()
        for row in rows
        if str(row.get("owner_username") or row.get("responsable") or "").strip()
    })
    return ", ".join(owners) or "Equipo de Procura"


def _send_tracking_status_event(numero: str, rows: List[Dict[str, Any]], event_type: str, event_value: str, text: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    return notification_service.send_telegram_once(
        db,
        event_key=_notification_event_key("telegram", numero, event_type, event_value),
        event_type=event_type,
        numero_licitacion=numero,
        owner_username=_tracking_recipients(rows),
        text=text,
        payload=payload,
    )


def _apply_tracked_sli_result(numero: str, rows: List[Dict[str, Any]], result: Dict[str, Any], *, persist: bool, apply_status: bool = True) -> Dict[str, int]:
    """Compara una lectura directa del SLI contra el último snapshot y notifica transiciones reales."""
    stats = {"sent": 0, "duplicates": 0, "errors": 0, "updated": 0}
    if not result or result.get("error"):
        return stats

    current_state = result.get("estado_acp") if isinstance(result.get("estado_acp"), dict) else _normalize_sli_status(result.get("estatus"))
    current_code = str(current_state.get("code") or "DESCONOCIDO")
    if current_code == "DESCONOCIDO":
        return stats

    snapshots = [_tracking_snapshot(row.get("sli_snapshot_json")) for row in rows]
    known_states = [_snapshot_acp_status(snapshot).get("code") for snapshot in snapshots if snapshot]
    prior_code = next((code for code in known_states if code and code != current_code), "")
    has_baseline = bool(known_states)
    object_name = str(rows[0].get("seguimiento_objeto") or result.get("descripcion") or "Sin nombre registrado").strip()
    recipients = _tracking_recipients(rows)
    link = str(result.get("url") or rows[0].get("seguimiento_link_sli") or rows[0].get("radar_link_sli") or "").strip()
    award = result.get("adjudicacion") if isinstance(result.get("adjudicacion"), dict) else {}
    award_company = str(award.get("empresa_adjudicada") or "").strip()
    award_amount = str(award.get("monto_adjudicado") or "").strip()
    state_changed = bool(has_baseline and prior_code and prior_code != current_code)

    def deliver(event_type: str, event_value: str, text: str, payload: Dict[str, Any]):
        delivery = _send_tracking_status_event(numero, rows, event_type, event_value, text, payload)
        if delivery.get("duplicate"):
            stats["duplicates"] += 1
        elif delivery.get("ok"):
            stats["sent"] += 1
        elif not delivery.get("skipped"):
            stats["errors"] += 1
            logger.warning(f"[TELEGRAM] Fallo evento {event_type} RFQ {numero}: {delivery.get('error')}")

    # ENMENDADA se comunica mediante la alerta especializada de enmienda del Radar.
    if state_changed and current_code not in {"ABIERTAS", "ENMENDADA"}:
        lines = [
            "ESTADO ACP ACTUALIZADO", "", f"Licitacion: {numero}", f"Objeto: {object_name}",
            f"Cambio: {_normalize_sli_status(prior_code).get('label', prior_code)} -> {current_state.get('label', current_code)}",
        ]
        if current_code == "ADJUDICACION":
            if award.get("confirmada") and award_company:
                lines.append(f"Empresa adjudicada: {award_company}")
                if award_amount:
                    lines.append(f"Monto identificado: {award_amount}")
            else:
                lines.append("Resultado publicado; pendiente de confirmar empresa adjudicada en el acta.")
        lines.extend([f"Dirigida a: {recipients}", "", f"Revisar SLI: {link}"])
        deliver("sli_status", f"{prior_code}->{current_code}", "\n".join(lines), {"anterior": prior_code, "actual": current_code, "adjudicacion": award})

    previous_closes = [str(snapshot.get("fecha_cierre") or "").strip() for snapshot in snapshots if snapshot]
    current_close = str(result.get("fecha_cierre") or "").strip()
    prior_close = next((value for value in previous_closes if value and value != current_close), "")
    if has_baseline and prior_close and current_close and prior_close != current_close and not state_changed:
        deliver(
            "close_changed",
            f"{prior_close}->{current_close}",
            "\n".join([
                "CAMBIO DE FECHA DE CIERRE", "", f"Licitacion: {numero}", f"Objeto: {object_name}",
                f"Cierre anterior: {prior_close}", f"Nuevo cierre: {current_close}",
                f"Dirigida a: {recipients}", "", f"Revisar SLI: {link}",
            ]),
            {"anterior": prior_close, "nuevo": current_close},
        )

    previous_awards = {
        "|".join([
            str((snapshot.get("adjudicacion") or {}).get("empresa_adjudicada") or "").strip().lower(),
            str((snapshot.get("adjudicacion") or {}).get("monto_adjudicado") or "").strip().lower(),
        ])
        for snapshot in snapshots
        if snapshot
    }
    award_signature = f"{award_company.lower()}|{award_amount.lower()}"
    if has_baseline and current_code == "ADJUDICACION" and award.get("confirmada") and award_company and not state_changed and award_signature not in previous_awards:
        lines = [
            "RESULTADO DE ADJUDICACION", "", f"Licitacion: {numero}", f"Objeto: {object_name}",
            f"Empresa adjudicada: {award_company}",
        ]
        if award_amount:
            lines.append(f"Monto identificado: {award_amount}")
        lines.extend([f"Dirigida a: {recipients}", "", f"Revisar SLI: {link}"])
        deliver("award_result", award_signature, "\n".join(lines), {"empresa": award_company, "monto": award_amount, "evidencia": award.get("evidencia", "")})

    next_internal_status = _tracking_internal_status(current_code)
    for row in rows:
        tracking_id = int(row["seguimiento_id"])
        if apply_status and next_internal_status and str(row.get("seguimiento_estado") or "") != next_internal_status:
            note = f"Estado ACP sincronizado: {current_state.get('label', current_code)}."
            if current_code == "ADJUDICACION" and award.get("confirmada") and award_company:
                note += f" Empresa adjudicada: {award_company}."
            db.actualizar_estado(tracking_id, next_internal_status, note, "Sistema SLI")
            stats["updated"] += 1
        if persist:
            db.guardar_snapshot_sli(tracking_id, result)
    return stats


def sync_tracked_tenders_from_sli() -> Dict[str, int]:
    """Consulta el detalle SLI por número para cada proceso seguido, incluso si ya salió de abiertas."""
    totals = {"checked": 0, "sent": 0, "duplicates": 0, "errors": 0, "updated": 0}
    try:
        candidates = db.get_tracking_notification_candidates()
    except Exception as exc:
        logger.warning(f"[SEGUIMIENTO SLI] No se pudieron cargar seguimientos: {exc}")
        totals["errors"] += 1
        return totals
    if candidates is None or candidates.empty:
        return totals

    grouped: Dict[str, List[Dict[str, Any]]] = {}
    for row in candidates.to_dict(orient="records"):
        numero = "".join(filter(str.isdigit, str(row.get("numero_licitacion") or "")))
        if numero:
            grouped.setdefault(numero, []).append(row)

    max_per_scan = max(1, int(os.getenv("SEGUIMIENTO_SLI_MAX_PER_SCAN", "20") or 20))
    for numero, rows in list(grouped.items())[:max_per_scan]:
        try:
            result = consultar_sli(numero, _token=INTERNAL_API_TOKEN)
            result_stats = _apply_tracked_sli_result(numero, rows, result, persist=True)
            totals["checked"] += 1
            for key in ("sent", "duplicates", "errors", "updated"):
                totals[key] += result_stats[key]
        except HTTPException as exc:
            totals["errors"] += 1
            logger.warning(f"[SEGUIMIENTO SLI] RFQ {numero}: {exc.detail}")
        except Exception as exc:
            totals["errors"] += 1
            logger.exception(f"[SEGUIMIENTO SLI] Error consultando RFQ {numero}: {exc}")
    return totals


def verify_internal_token(x_internal_token: str = Header(None)):
    if x_internal_token != INTERNAL_API_TOKEN:
        raise HTTPException(status_code=403, detail="Acceso denegado: Token interno invalido.")
    return x_internal_token


def _b64url_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _b64url_decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode((value + padding).encode("ascii"))


def create_session_token(username: str, role: str) -> str:
    payload = {
        "u": str(username or ""),
        "r": str(role or ""),
        "exp": int(time.time()) + SESSION_TTL_SECONDS,
    }
    payload_b64 = _b64url_encode(json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8"))
    signature = hmac.new(INTERNAL_API_TOKEN.encode("utf-8"), payload_b64.encode("ascii"), hashlib.sha256).digest()
    return f"{payload_b64}.{_b64url_encode(signature)}"


def verify_session_token(x_procura_session: str = Header(None)) -> Dict[str, Any]:
    if not x_procura_session or "." not in x_procura_session:
        raise HTTPException(status_code=401, detail="Sesion requerida.")
    payload_b64, signature_b64 = x_procura_session.split(".", 1)
    expected = _b64url_encode(hmac.new(INTERNAL_API_TOKEN.encode("utf-8"), payload_b64.encode("ascii"), hashlib.sha256).digest())
    if not hmac.compare_digest(signature_b64, expected):
        raise HTTPException(status_code=401, detail="Sesion invalida.")
    try:
        payload = json.loads(_b64url_decode(payload_b64).decode("utf-8"))
    except Exception:
        raise HTTPException(status_code=401, detail="Sesion invalida.")
    if int(payload.get("exp") or 0) < int(time.time()):
        raise HTTPException(status_code=401, detail="Sesion expirada. Inicia sesion nuevamente.")
    return payload


def require_admin_session(
    _token: str = Depends(verify_internal_token),
    session: Dict[str, Any] = Depends(verify_session_token),
) -> Dict[str, Any]:
    if str(session.get("r") or "") != "Admin":
        raise HTTPException(status_code=403, detail="Solo un usuario Admin puede acceder a esta herramienta.")
    return session


def require_logistics_admin_session(
    _token: str = Depends(verify_internal_token),
    session: Dict[str, Any] = Depends(verify_session_token),
) -> Dict[str, Any]:
    role = str(session.get("r") or "")
    if role not in ("Logistica", "Admin"):
        raise HTTPException(status_code=403, detail="Solo Logistica o Admin puede modificar valores logisticos.")
    return session


def require_management_session(
    _token: str = Depends(verify_internal_token),
    session: Dict[str, Any] = Depends(verify_session_token),
) -> Dict[str, Any]:
    role = str(session.get("r") or "").strip()
    if role not in ("Gerencia", "Admin"):
        raise HTTPException(status_code=403, detail="Solo Gerencia o Admin puede consultar metricas.")
    return session
# --- 3. APP FASTAPI ---
app = FastAPI(title="Proyelec Core API v6.1")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:8501",
        "http://127.0.0.1:8501",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        *([FRONTEND_ORIGIN] if FRONTEND_ORIGIN else []),
    ],
    allow_origin_regex=r"https://.*\.up\.railway\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def run_radar_auto_scan(source="scheduler"):
    """Ejecuta el escaneo del Radar SLI de forma segura para jobs automáticos."""
    if not _radar_scan_lock.acquire(blocking=False):
        logger.info("[RADAR AUTO] Escaneo omitido: ya hay un escaneo en curso.")
        return {"status": "skipped", "reason": "scan_already_running"}

    RADAR_SCHEDULER_STATE["running"] = True
    RADAR_SCHEDULER_STATE["last_started"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    RADAR_SCHEDULER_STATE["last_error"] = None

    try:
        import sli_scraper
        logger.info(f"[RADAR AUTO] Iniciando escaneo SLI ({source}).")
        result = sli_scraper.ejecutar_radar_detallado(db_module=db)
        result_summary = {key: value for key, value in result.items() if key != "licitaciones"}
        try:
            result_summary["seguimiento_sli"] = sync_tracked_tenders_from_sli()
        except Exception as tracking_error:
            logger.exception(f"[SEGUIMIENTO SLI] No se pudieron sincronizar procesos seguidos: {tracking_error}")
            result_summary["seguimiento_sli"] = {"checked": 0, "sent": 0, "errors": 1, "error": str(tracking_error)[:500]}
        try:
            result_summary["notifications"] = process_tracking_notifications()
        except Exception as notification_error:
            logger.exception(f"[TELEGRAM] No se pudieron procesar alertas: {notification_error}")
            result_summary["notifications"] = {"sent": 0, "errors": 1, "error": str(notification_error)[:500]}
        RADAR_SCHEDULER_STATE["last_result"] = result_summary
        RADAR_SCHEDULER_STATE["last_finished"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        logger.info(f"[RADAR AUTO] Escaneo completado: {result_summary}")
        return {"status": "success", "result": result_summary}
    except Exception as exc:
        error_text = str(exc)
        RADAR_SCHEDULER_STATE["last_error"] = error_text
        RADAR_SCHEDULER_STATE["last_finished"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        try:
            db.registrar_escaneo_radar(0, 0, f"Auto radar error: {error_text}")
        except Exception:
            logger.exception("[RADAR AUTO] No se pudo registrar error de escaneo.")
        logger.exception(f"[RADAR AUTO] Error en escaneo: {error_text}")
        return {"status": "error", "error": error_text}
    finally:
        RADAR_SCHEDULER_STATE["running"] = False
        _radar_scan_lock.release()

def radar_scheduler_loop():
    interval_seconds = RADAR_AUTO_SCAN_INTERVAL_MINUTES * 60
    if RADAR_AUTO_SCAN_ON_STARTUP:
        run_radar_auto_scan(source="startup")
    while not _radar_scheduler_stop.is_set():
        next_run_ts = time.time() + interval_seconds
        RADAR_SCHEDULER_STATE["next_run_at"] = datetime.fromtimestamp(next_run_ts).strftime("%Y-%m-%d %H:%M:%S")
        if _radar_scheduler_stop.wait(interval_seconds):
            break
        run_radar_auto_scan()

def _radar_latest_persisted_scan():
    try:
        scans = db.get_ultimos_escaneos(1)
        if scans is None or scans.empty:
            return None
        return {key: _radar_json_safe(value) for key, value in scans.iloc[0].to_dict().items()}
    except Exception as exc:
        logger.warning(f"[RADAR AUTO] No se pudo leer el ultimo escaneo persistido: {exc}")
        return None

def _radar_scan_is_stale(scan=None):
    scan = scan or _radar_latest_persisted_scan()
    if not scan or not scan.get("fecha"):
        return True
    try:
        scanned_at = datetime.fromisoformat(str(scan.get("fecha")).replace("Z", "+00:00"))
        if scanned_at.tzinfo:
            scanned_at = scanned_at.replace(tzinfo=None)
        age_seconds = max(0, (datetime.now() - scanned_at).total_seconds())
        completed = str(scan.get("escaneo_completo") or "").strip().lower() in {"true", "1", "yes", "si"}
        retry_minutes = RADAR_AUTO_SCAN_INTERVAL_MINUTES if completed else min(5, RADAR_AUTO_SCAN_INTERVAL_MINUTES)
        return age_seconds >= retry_minutes * 60
    except (TypeError, ValueError):
        return True

def _trigger_radar_scan_if_stale(source="lazy_refresh"):
    latest = _radar_latest_persisted_scan()
    if not RADAR_AUTO_SCAN_ENABLED or not _radar_scan_is_stale(latest):
        return False
    if RADAR_SCHEDULER_STATE.get("running") or _radar_scan_lock.locked():
        return False
    thread = threading.Thread(
        target=run_radar_auto_scan,
        kwargs={"source": source},
        name="radar-sli-lazy-refresh",
        daemon=True,
    )
    thread.start()
    return True

@app.on_event("startup")
def start_radar_scheduler():
    global _radar_scheduler_thread
    try:
        db.init_db()
        logger.info("[DB] Esquema verificado/inicializado correctamente.")
    except Exception as exc:
        logger.exception(f"[DB] No se pudo inicializar/verificar el esquema: {exc}")
    if not RADAR_AUTO_SCAN_ENABLED:
        logger.info("[RADAR AUTO] Scheduler desactivado por variable de entorno.")
        return
    if _radar_scheduler_thread and _radar_scheduler_thread.is_alive():
        return
    _radar_scheduler_stop.clear()
    _radar_scheduler_thread = threading.Thread(target=radar_scheduler_loop, name="radar-sli-scheduler", daemon=True)
    _radar_scheduler_thread.start()
    logger.info(f"[RADAR AUTO] Scheduler iniciado cada {RADAR_AUTO_SCAN_INTERVAL_MINUTES} minutos.")

@app.on_event("shutdown")
def stop_radar_scheduler():
    _radar_scheduler_stop.set()
    logger.info("[RADAR AUTO] Scheduler detenido.")

@app.get("/api/v1/radar/scheduler")
def radar_scheduler_status(_token: str = Depends(verify_internal_token)):
    latest = _radar_latest_persisted_scan()
    if latest and not RADAR_SCHEDULER_STATE.get("last_finished"):
        RADAR_SCHEDULER_STATE["last_finished"] = latest.get("fecha")
        RADAR_SCHEDULER_STATE["last_result"] = {
            "total": latest.get("total_encontradas", 0),
            "nuevas": latest.get("nuevas", 0),
            "paginas_recorridas": latest.get("paginas_recorridas", 0),
            "escaneo_completo": bool(latest.get("escaneo_completo")),
            "errores": latest.get("errores") or "",
        }
        if latest.get("errores") or not _radar_bool(latest.get("escaneo_completo")):
            RADAR_SCHEDULER_STATE["last_error"] = latest.get("errores") or "El ultimo escaneo no confirmo cobertura completa."
    _trigger_radar_scan_if_stale(source="radar_opened")
    return {**RADAR_SCHEDULER_STATE, "stale": _radar_scan_is_stale(latest)}


@app.get("/api/v1/admin/notifications/telegram")
def telegram_notification_status(_session: Dict[str, Any] = Depends(require_admin_session)):
    return {"status": "success", "telegram": notification_service.telegram_status()}


@app.post("/api/v1/admin/notifications/telegram/test")
def telegram_notification_test(session: Dict[str, Any] = Depends(require_admin_session)):
    username = str(session.get("u") or "Admin")
    result = notification_service.send_telegram_message(
        "\n".join([
            "PRUEBA DE ALERTAS PROCURA AI",
            "",
            "La conexion con el grupo ACP ALERTAS funciona correctamente.",
            f"Solicitada por: {username}",
            f"Dirigida a: {username}",
            f"Fecha: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
        ])
    )
    if not result.get("ok"):
        raise HTTPException(status_code=503, detail=result.get("error") or "No se pudo enviar la prueba a Telegram.")
    return {"status": "success", "message_id": result.get("message_id")}

@app.get("/api/v1/radar/stats")
def radar_stats(_token: str = Depends(verify_internal_token)):
    """Endpoint ligero: 4 contadores para el dashboard sin cargar filas completas."""
    try:
        df = db.get_licitaciones_radar(solo_nuevas=False, solo_hoy=False)
        if df.empty:
            return {"status": "success", "total": 0, "alertas": 0, "en_seguimiento": 0, "cierre_72h": 0}
        total = int(len(df))
        def _bool_safe(v):
            return str(v or "").strip().lower() in ["true", "1", "yes", "si"]
        alertas = int(df["enmienda_alerta"].apply(_bool_safe).sum()) if "enmienda_alerta" in df.columns else 0
        en_seguimiento = int((df["estado_radar"] == "en_seguimiento").sum()) if "estado_radar" in df.columns else 0
        cierre_72h = 0
        if "fecha_cierre" in df.columns:
            now_ts = time.time()
            limit_ts = now_ts + 72 * 3600
            def _within_72h(val):
                try:
                    from sli_scraper import parse_sli_datetime
                    dt = parse_sli_datetime(val)
                    return bool(dt and now_ts <= dt.timestamp() <= limit_ts)
                except Exception:
                    return False
            cierre_72h = int(df["fecha_cierre"].apply(_within_72h).sum())
        return {"status": "success", "total": total, "alertas": alertas,
                "en_seguimiento": en_seguimiento, "cierre_72h": cierre_72h}
    except Exception as exc:
        logger.warning(f"[RADAR STATS] {exc}")
        return {"status": "error", "total": 0, "alertas": 0, "en_seguimiento": 0, "cierre_72h": 0}

@app.get("/api/v1/radar/escaneos")
def radar_escaneos(limit: int = Query(10, ge=1, le=100), _token: str = Depends(verify_internal_token)):
    return {"status": "success", "escaneos": _json_records(db.get_ultimos_escaneos(limite=limit))}

@app.post("/api/v1/radar/scan-now")
def radar_scan_now(_token: str = Depends(verify_internal_token)):
    return run_radar_auto_scan(source="manual_api")

def _radar_bool(value):
    if isinstance(value, bool):
        return value
    text = str(value or "").strip().lower()
    return text in ["true", "1", "yes", "si", "sí"]

class RadarEstadoRequest(BaseModel):
    estado: str
    usuario: str = "frontend"
    notas: str = ""

def _radar_datetime_iso(value):
    try:
        from sli_scraper import parse_sli_datetime
        dt = parse_sli_datetime(value)
        return dt.isoformat() if dt else None
    except Exception:
        return None

def _radar_json_safe(value):
    if isinstance(value, dict):
        return {key: _radar_json_safe(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_radar_json_safe(item) for item in value]
    try:
        if pd.isna(value):
            return None
    except (TypeError, ValueError):
        pass
    if hasattr(value, "item"):
        return value.item()
    return value

def _extract_acp_codes_from_text(text):
    pattern = r"\b[A-Z]{3}-[A-Z]{3}-\d{5}\b"
    return list(dict.fromkeys(re.findall(pattern, str(text or "").upper())))

RADAR_ACP_ITEM_START_RE = re.compile(
    r"^\s*(?:[\u2022\-*]\s*)?(?:(?:rengl[oó]n|l[ií]nea|item|[ií]tem)\s*(?:n[oº°.]*)?\s*#?\s*\d{1,4}\s*[:.\-)\u2013|]?\s*|\d{1,4}(?:\s*[.\-):|]\s*|\s+))?"
    r"([A-Z]{3}-[A-Z]{3}-\d{5})(?=$|[\s|:;,])",
    re.IGNORECASE,
)
RADAR_ROW_MARKER_RE = re.compile(
    r"^\s*(?:[\u2022\-*]\s*)?(?:rengl[oó]n|l[ií]nea|item|[ií]tem)\s*(?:n[oº°.]*)?\s*#?\s*(\d{1,4})\s*[:.\-)\u2013]?\s*(.*)$",
    re.IGNORECASE,
)
RADAR_BARE_ROW_NUMBER_RE = re.compile(r"^\s*(\d{1,4})\s*$")
RADAR_NUMBERED_ROW_RE = re.compile(r"^\s*(\d{1,4})(?:\s*[.\-):|]\s*|\s+)(.+)$")

def _extract_radar_item_start_code(value):
    """Acepta un codigo ACP solo al inicio semantico de un renglón."""
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    match = RADAR_ACP_ITEM_START_RE.match(text)
    return match.group(1).upper() if match else ""

def _clean_sli_fragment(value):
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    text = re.sub(r"\s*[:;]\s*$", "", text)
    return text

def _looks_like_sli_label(value):
    text = _clean_sli_fragment(value).lower()
    if not text:
        return True
    labels = {
        "licitacion",
        "licitacion publica",
        "licitacion publica precio mas bajo",
        "agente de compras",
        "fecha de publicacion",
        "ultima revision",
        "fecha y hora de cierre",
        "unidad de compras",
        "# enmienda",
        "estatus",
        "estado",
        "descripcion",
        "cantidad",
        "unidad",
        "precio",
        "renglon",
        "linea",
        "item",
    }
    return text in labels or text.endswith(":")

SLI_STRUCTURED_ACP_RE = re.compile(
    r"art[ií]culo\s+ACP\s*:\s*([A-Z]{3}-[A-Z]{3}-\d{5})(?=$|[\s|:;,])",
    re.IGNORECASE,
)
RADAR_DOCUMENT_PARSER_VERSION = 4

def _radar_parser_cache_current(cache):
    if not cache or not isinstance(cache.get("result"), dict):
        return False
    try:
        return int(cache["result"].get("parser_version") or 0) >= RADAR_DOCUMENT_PARSER_VERSION
    except (TypeError, ValueError):
        return False

def _extract_sli_structured_items(soup, document_url=""):
    """Extrae las filas del detalle SLI usando sus columnas HTML reales."""
    items = []
    seen = set()
    for item_row in soup.select("div.row"):
        columns = item_row.find_all("div", recursive=False)
        if len(columns) < 5:
            continue
        first_classes = columns[0].get("class") or []
        description_classes = columns[1].get("class") or []
        if "col-lg-1" not in first_classes or "col-lg-5" not in description_classes:
            continue

        row_text = _clean_sli_fragment(columns[0].get_text(" ", strip=True))
        if not re.fullmatch(r"\d{1,4}", row_text):
            continue
        row_number = row_text
        description_column = columns[1]
        description_text = _clean_sli_fragment(description_column.get_text(" ", strip=True))
        code_match = SLI_STRUCTURED_ACP_RE.search(description_text)
        code = code_match.group(1).upper() if code_match else ""
        key = (row_number, code, description_text[:120])
        if key in seen:
            continue
        seen.add(key)

        if code:
            repeated_label = re.compile(
                rf"(?:art[ií]culo\s+ACP\s*:\s*{re.escape(code)}\s*)+",
                re.IGNORECASE,
            )
            description = repeated_label.sub("", description_text)
        else:
            description = re.sub(
                r"(?:art[ií]culo\s+ACP\s*:\s*(?:S/C|N/?A|NO\s+APLICA|SIN\s+C[OÓ]DIGO)?\s*)+",
                "",
                description_text,
                flags=re.IGNORECASE,
            )
        description = re.sub(r"\binformaci[oó]n adicional\b", "", description, flags=re.IGNORECASE)
        description = _clean_sli_fragment(description) or "Descripcion no especificada en el detalle SLI."
        unit = _clean_sli_fragment(columns[2].get_text(" ", strip=True))
        quantity = _clean_sli_fragment(columns[3].get_text(" ", strip=True))
        category = _clean_sli_fragment(columns[4].get_text(" ", strip=True))
        evidence = _clean_sli_fragment(item_row.get_text(" ", strip=True))[:500]
        items.append({
            "renglon": f"Renglon {row_number}",
            "renglon_numero": row_number,
            "codigo_articulo": code or None,
            "codigo_acp": code or None,
            "estado_codigo": "confirmado" if code else "sin_codigo",
            "descripcion": description[:450],
            "cantidad": quantity or None,
            "unidad": unit or None,
            "categoria": category or None,
            "fuente": "sli_estructurado",
            "documento": "Detalle visible SLI",
            "documento_url": document_url or None,
            "pagina": None,
            "evidencia": evidence,
        })
    return items

def _merge_radar_items(primary_items, secondary_items, limit=80):
    primary = [dict(item) for item in (primary_items or []) if isinstance(item, dict)]
    if not primary:
        # Sin una tabla HTML que confirme el renglon, el PDF solo aporta filas
        # cuando contienen un codigo ACP estricto. Esto evita confundir fechas,
        # numerales de clausulas o paginas con renglones reales.
        return [
            item for item in (secondary_items or [])
            if isinstance(item, dict)
            and str(item.get("estado_codigo") or "") == "confirmado"
            and (item.get("codigo_acp") or item.get("codigo_articulo"))
        ][:limit]

    by_row = {
        str(item.get("renglon_numero") or ""): item
        for item in primary
        if str(item.get("renglon_numero") or "")
    }
    seen_codes = {
        str(item.get("codigo_acp") or item.get("codigo_articulo") or "").upper()
        for item in primary
        if item.get("codigo_acp") or item.get("codigo_articulo")
    }

    for item in secondary_items or []:
        if not isinstance(item, dict):
            continue
        code = str(item.get("codigo_acp") or item.get("codigo_articulo") or "").upper()
        if not code or str(item.get("estado_codigo") or "") != "confirmado":
            continue
        row_number = str(item.get("renglon_numero") or "")
        target = by_row.get(row_number)
        if target is not None:
            if not (target.get("codigo_acp") or target.get("codigo_articulo")):
                target["codigo_acp"] = code
                target["codigo_articulo"] = code
                target["estado_codigo"] = "confirmado"
                target["documento_codigo"] = item.get("documento")
                target["pagina_codigo"] = item.get("pagina")
                target["evidencia_codigo"] = item.get("evidencia")
                seen_codes.add(code)
            continue
        if code in seen_codes:
            continue
        primary.append(item)
        seen_codes.add(code)
        if len(primary) >= limit:
            break
    return primary[:limit]

def _extract_radar_items_from_documents(documents, limit=80):
    """Extrae renglones con evidencia de documento/pagina sin inferir codigos."""
    items = []
    seen = set()
    synthetic_row = 0
    for document in documents or []:
        document_name = str(document.get("nombre") or "Detalle SLI")
        document_url = str(document.get("url") or "")
        document_type = str(document.get("tipo") or ("rfq_pdf" if document_url else "sli_visible"))
        for page_data in document.get("paginas") or []:
            page_number = int(page_data.get("pagina") or 0) or None
            raw_text = str(page_data.get("texto") or "")
            pending_row_number = ""
            lines = [
                _clean_sli_fragment(line)
                for line in re.split(r"\n+|\|+", raw_text)
                if _clean_sli_fragment(line)
            ]
            for index, line in enumerate(lines):
                bare_row_match = RADAR_BARE_ROW_NUMBER_RE.match(line)
                if bare_row_match:
                    pending_row_number = bare_row_match.group(1)
                    continue

                row_match = RADAR_ROW_MARKER_RE.match(line)
                numbered_row_match = RADAR_NUMBERED_ROW_RE.match(line) if not row_match else None
                row_number = row_match.group(1) if row_match else (numbered_row_match.group(1) if numbered_row_match else "")
                candidate = (
                    (row_match.group(2) or "").strip()
                    if row_match
                    else ((numbered_row_match.group(2) or "").strip() if numbered_row_match else line)
                )
                has_row_context = bool(row_match or numbered_row_match)

                if pending_row_number and not has_row_context and not _looks_like_sli_label(candidate):
                    row_number = pending_row_number
                    has_row_context = True
                    pending_row_number = ""

                if row_match and not candidate:
                    for next_line in lines[index + 1:index + 4]:
                        if not _looks_like_sli_label(next_line):
                            candidate = next_line
                            break

                if not has_row_context:
                    continue
                code = _extract_radar_item_start_code(candidate)
                if not candidate or _looks_like_sli_label(candidate):
                    continue

                synthetic_row += 1
                row_label = f"Renglon {row_number}" if row_number else f"Renglon detectado {synthetic_row}"
                description = candidate
                if code:
                    description = RADAR_ACP_ITEM_START_RE.sub("", candidate, count=1).strip(" -:;|")
                    if len(description) < 8:
                        for next_line in lines[index + 1:index + 3]:
                            if not _looks_like_sli_label(next_line) and not RADAR_ROW_MARKER_RE.match(next_line):
                                description = f"{description} {next_line}".strip()
                                break
                description = re.sub(r"\s+", " ", description).strip(" -|")[:450]
                if not description and not code:
                    continue

                key = (row_label, code or "S/C", description[:100])
                if key in seen:
                    continue
                seen.add(key)
                evidence = line[:500]
                items.append({
                    "renglon": row_label,
                    "renglon_numero": row_number or None,
                    "codigo_articulo": code or None,
                    "codigo_acp": code or None,
                    "estado_codigo": "confirmado" if code else "sin_codigo",
                    "descripcion": description or "Descripcion no especificada en el documento.",
                    "fuente": document_type,
                    "documento": document_name,
                    "documento_url": document_url or None,
                    "pagina": page_number,
                    "evidencia": evidence,
                })
                if len(items) >= limit:
                    return items
    return items

def _extract_sli_visible_items(text, limit=80):
    return _extract_radar_items_from_documents(
        [{"nombre": "Detalle visible SLI", "url": "", "paginas": [{"pagina": 1, "texto": str(text or "")}]}],
        limit=limit,
    )

@app.get("/api/v1/radar/licitaciones")
def radar_licitaciones(
    solo_nuevas: bool = False,
    solo_hoy: bool = False,
    solo_alertas: bool = False,
    search: str = "",
    limit: int = Query(500, ge=1, le=2000),
    _token: str = Depends(verify_internal_token)
):
    _trigger_radar_scan_if_stale(source="radar_list_opened")
    df = db.get_licitaciones_radar(solo_nuevas=solo_nuevas, solo_hoy=solo_hoy)
    if df.empty:
        return {"status": "success", "total": 0, "items": []}

    if solo_alertas and "enmienda_alerta" in df.columns:
        df = df[df["enmienda_alerta"].apply(_radar_bool)].copy()

    if search:
        terms = [term.strip().lower() for term in search.split() if term.strip()]
        haystack = df.fillna("").astype(str).agg(" ".join, axis=1).str.lower()
        mask = pd.Series(True, index=df.index)
        for term in terms:
            mask &= haystack.str.contains(re.escape(term), na=False)
        df = df[mask].copy()

    if not df.empty:
        df["fecha_apertura_iso"] = df["fecha_apertura"].apply(_radar_datetime_iso) if "fecha_apertura" in df.columns else None
        df["fecha_cierre_iso"] = df["fecha_cierre"].apply(_radar_datetime_iso) if "fecha_cierre" in df.columns else None
        if "fecha_apertura_iso" in df.columns:
            df["_sort_publicacion"] = pd.to_datetime(df["fecha_apertura_iso"], errors="coerce")
            df = df.sort_values(["_sort_publicacion", "numero_licitacion"], ascending=[False, False], na_position="last")
            df = df.drop(columns=["_sort_publicacion"], errors="ignore")

    records = [
        {key: _radar_json_safe(value) for key, value in row.items()}
        for row in df.head(limit).to_dict(orient="records")
    ]
    return {"status": "success", "total": len(df), "items": records}

@app.post("/api/v1/radar/{licitacion_id}/estado")
def radar_cambiar_estado(licitacion_id: int, req: RadarEstadoRequest, _token: str = Depends(verify_internal_token)):
    estados_validos = {"nueva", "revisada", "descartada", "en_seguimiento"}
    if req.estado not in estados_validos:
        raise HTTPException(status_code=400, detail="Estado de radar inválido.")
    db.marcar_licitacion_radar(licitacion_id, req.estado, req.usuario, req.notas)
    return {"status": "success", "id": licitacion_id, "estado": req.estado}

@app.post("/api/v1/radar/{licitacion_id}/ack-enmienda")
def radar_ack_enmienda(licitacion_id: int, _token: str = Depends(verify_internal_token)):
    db.marcar_alerta_enmienda_revisada(licitacion_id)
    return {"status": "success", "id": licitacion_id}


def _consultar_sli_visible_detail_for_radar(rfq_id: str):
    """Lee bajo demanda el detalle SLI y los PDF RFQ, sin guardar archivos fisicos."""
    rfq_id = "".join(filter(str.isdigit, str(rfq_id or "")))
    if not rfq_id:
        return {"consultado": False, "error": "Numero de licitacion invalido.", "codigos_acp_detectados": [], "renglones_detectados": []}

    try:
        from playwright.sync_api import Error as PlaywrightError, TimeoutError as PlaywrightTimeoutError, sync_playwright
    except ImportError:
        return {"consultado": False, "error": "Playwright no esta instalado en el backend.", "codigos_acp_detectados": [], "renglones_detectados": []}

    SLI_HOME_URL = "https://apps.pancanal.com/sli/LicitacionesBusqueda/Welcome"
    browser = None
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(
                headless=True,
                args=["--no-sandbox", "--disable-dev-shm-usage", "--disable-blink-features=AutomationControlled"],
            )
            context = browser.new_context(
                ignore_https_errors=True,
                extra_http_headers={
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124"
                },
            )
            page = context.new_page()
            page.set_default_timeout(10000)
            page.goto(SLI_HOME_URL, wait_until="domcontentloaded", timeout=20000)
            page.wait_for_selector("#rfqId", timeout=10000)
            page.fill("#rfqId", rfq_id)
            if page.locator("#hfEstatusSeleccionadoID").count() > 0:
                page.evaluate('document.getElementById("hfEstatusSeleccionadoID").value = "TODOS";')
            page.click("input[type='submit']")
            try:
                page.wait_for_function(
                    "() => document.body.innerText.includes('Detalle de RFQ') || "
                    "document.body.innerText.includes('Licitacion') || "
                    "document.body.innerText.includes('Licitaci') || "
                    "document.body.innerText.includes('No se encontraron')",
                    timeout=15000,
                )
            except PlaywrightTimeoutError:
                pass
            try:
                page.wait_for_function(
                    r"""() => Array.from(document.querySelectorAll('div.row')).some(row => {
                        const children = Array.from(row.children || []);
                        const first = (children[0]?.textContent || '').trim();
                        return children.length >= 5 && /^\d{1,4}$/.test(first);
                    })""",
                    timeout=8000,
                )
                previous_count = -1
                stable_checks = 0
                for _ in range(10):
                    current_count = page.locator("div.row").evaluate_all(
                        r"""rows => rows.filter(row => {
                            const children = Array.from(row.children || []);
                            const first = (children[0]?.textContent || '').trim();
                            return children.length >= 5 && /^\d{1,4}$/.test(first);
                        }).length"""
                    )
                    if current_count > 0 and current_count == previous_count:
                        stable_checks += 1
                        if stable_checks >= 2:
                            break
                    else:
                        stable_checks = 0
                    previous_count = current_count
                    page.wait_for_timeout(300)
            except PlaywrightTimeoutError:
                logger.warning(f"Radar historico: la matriz SLI {rfq_id} no termino de renderizar a tiempo.")
            content = page.content()
            soup = BeautifulSoup(content, "html.parser")
            texto_sli = soup.get_text(separator="|", strip=True)
            structured_sli_items = _extract_sli_structured_items(soup, document_url=page.url)
            fingerprint = hashlib.sha256(content.encode("utf-8", errors="ignore"))
            pdf_urls = []
            documents = [{
                "nombre": "Detalle visible SLI",
                "url": page.url,
                "paginas": [{"pagina": 0, "texto": texto_sli}],
                "tipo": "sli_visible",
            }]
            requiere_ocr = False
            try:
                candidate_links = []

                # El SLI no expone la impresion RFQ como un enlace PDF normal.
                # El boton carga el documento en un iframe; lo resolvemos antes
                # de inspeccionar anexos y pliegos visibles.
                print_button = page.locator(".Modal_ReporteImpresionRFQ")
                if print_button.count() > 0:
                    try:
                        print_button.first.click()
                        page.wait_for_function(
                            """() => {
                                const frame = document.querySelector('#hiddenFramemodal_ReporteImpresionRFQ');
                                const src = frame?.getAttribute('src') || '';
                                return src && !src.includes('loading.gif') && src !== 'about:blank';
                            }""",
                            timeout=10000,
                        )
                        print_src = page.locator("#hiddenFramemodal_ReporteImpresionRFQ").get_attribute("src")
                        if print_src:
                            candidate_links.append({
                                "href": urljoin(page.url, print_src),
                                "text": "Impresion RFQ",
                            })
                    except Exception as print_exc:
                        logger.warning(f"Radar historico: no se pudo resolver impresion RFQ SLI {rfq_id}: {print_exc}")

                candidate_links.extend(page.evaluate(
                    """() => Array.from(document.querySelectorAll('a[href]'))
                        .map(a => ({ href: a.href, text: (a.textContent || '').trim() }))
                        .filter(a => a.href && (
                            a.href.toLowerCase().includes('.pdf') ||
                            a.href.toLowerCase().includes('impresion') ||
                            a.text.toLowerCase().includes('pdf') ||
                            a.text.toLowerCase().includes('pliego') ||
                            a.text.toLowerCase().includes('rfq') ||
                            a.text.toLowerCase().includes('documento') ||
                            a.text.toLowerCase().includes('anexo') ||
                            a.text.toLowerCase().includes('enmienda')
                        ))
                        """
                ) or [])
                seen_pdf = set()
                max_pdfs = max(1, min(12, int(os.getenv("RADAR_RFQ_MAX_PDFS", "8") or 8)))
                max_pages = max(1, min(80, int(os.getenv("RADAR_RFQ_MAX_PAGES", "40") or 40)))
                max_bytes = max(1_000_000, int(os.getenv("RADAR_RFQ_MAX_BYTES", "15000000") or 15_000_000))
                for candidate in candidate_links:
                    href = str((candidate or {}).get("href") or "")
                    label = _clean_sli_fragment((candidate or {}).get("text") or "")
                    if not href or href in seen_pdf or len(pdf_urls) >= max_pdfs:
                        continue
                    if urlparse(href).scheme.lower() not in {"http", "https"}:
                        continue
                    seen_pdf.add(href)
                    try:
                        response_pdf = page.request.get(href, headers={"Referer": page.url}, timeout=20000)
                        body = response_pdf.body()
                        content_type = (response_pdf.headers.get("content-type") or "").lower()
                        if not ("pdf" in content_type or body[:4] == b"%PDF"):
                            continue
                        if len(body) > max_bytes:
                            logger.warning(f"Radar historico: PDF omitido por tamano ({len(body)} bytes) {href}")
                            continue
                        from pypdf import PdfReader
                        reader = PdfReader(io.BytesIO(body))
                        pages = []
                        for page_number, pdf_page in enumerate(reader.pages[:max_pages], start=1):
                            extracted = pdf_page.extract_text() or ""
                            if extracted.strip():
                                pages.append({"pagina": page_number, "texto": extracted[:24000]})
                        if not pages:
                            requiere_ocr = True
                            continue
                        fingerprint.update(body)
                        pdf_urls.append(href)
                        fallback_name = os.path.basename(urlparse(href).path) or f"Documento RFQ {len(pdf_urls)}"
                        documents.append({
                            "nombre": label or fallback_name,
                            "url": href,
                            "paginas": pages,
                            "tipo": "rfq_pdf",
                        })
                    except Exception as pdf_exc:
                        logger.warning(f"Radar historico: no se pudo leer PDF SLI {rfq_id}: {pdf_exc}")
            except Exception as link_exc:
                logger.warning(f"Radar historico: no se pudieron listar PDFs SLI {rfq_id}: {link_exc}")

            pdf_documents = [document for document in documents if document.get("tipo") == "rfq_pdf"]
            pdf_items = _extract_radar_items_from_documents(pdf_documents, limit=80)
            if structured_sli_items:
                renglones = _merge_radar_items(structured_sli_items, pdf_items, limit=80)
            else:
                renglones = _extract_radar_items_from_documents(documents, limit=80)
            codigos = list(dict.fromkeys(
                str(item.get("codigo_articulo") or "").upper()
                for item in renglones
                if item.get("codigo_articulo")
            ))
            texto_total = "|".join(
                str(page_data.get("texto") or "")
                for document in documents
                for page_data in (document.get("paginas") or [])
            )
            document_summary = [
                {
                    "nombre": document.get("nombre"),
                    "url": document.get("url"),
                    "tipo": document.get("tipo"),
                    "paginas_leidas": len(document.get("paginas") or []),
                }
                for document in documents
                if document.get("tipo") == "rfq_pdf"
            ]
            return {
                "consultado": True,
                "status": "completed",
                "url": page.url,
                "pdfs_consultados": pdf_urls,
                "documentos": document_summary,
                "codigos_acp_detectados": codigos,
                "renglones_detectados": renglones,
                "texto_visible": texto_total[:24000],
                "document_fingerprint": fingerprint.hexdigest(),
                "parser_version": RADAR_DOCUMENT_PARSER_VERSION,
                "requiere_ocr": requiere_ocr,
                "analizado_en": datetime.now().isoformat(),
                "error": None,
            }
    except (PlaywrightError, PlaywrightTimeoutError) as exc:
        logger.warning(f"Radar historico: no se pudo consultar detalle SLI {rfq_id}: {exc}")
        return {"consultado": False, "status": "error", "error": str(exc)[:300], "codigos_acp_detectados": [], "renglones_detectados": []}
    except Exception as exc:
        logger.warning(f"Radar historico: error inesperado consultando SLI {rfq_id}: {exc}")
        return {"consultado": False, "status": "error", "error": str(exc)[:300], "codigos_acp_detectados": [], "renglones_detectados": []}
    finally:
        if browser:
            try:
                browser.close()
            except Exception:
                pass
@app.get("/api/v1/radar/{licitacion_id}/historico")
def radar_historico_matches(
    licitacion_id: int,
    limit: int = Query(12, ge=1, le=50),
    scan_sli: bool = Query(False),
    _token: str = Depends(verify_internal_token)
):
    initial = db.get_radar_historico_matches(licitacion_id, limit=limit)
    if initial is None:
        raise HTTPException(status_code=404, detail="Licitacion del radar no encontrada.")

    numero = (initial.get("radar") or {}).get("numero_licitacion")
    cache = db.get_radar_document_analysis(licitacion_id)
    if scan_sli and numero:
        sli_detail = _consultar_sli_visible_detail_for_radar(str(numero))
        db.save_radar_document_analysis(licitacion_id, sli_detail, analyzed_by="legacy_get")
        cache = db.get_radar_document_analysis(licitacion_id)
        result = db.get_radar_historico_matches(licitacion_id, limit=limit, sli_detail=sli_detail)
    elif cache and cache.get("available") and _radar_parser_cache_current(cache):
        result = db.get_radar_historico_matches(licitacion_id, limit=limit, sli_detail=cache.get("result"))
    else:
        result = initial

    cache_meta = {key: value for key, value in (cache or {}).items() if key != "result"}
    if cache_meta and not _radar_parser_cache_current(cache):
        cache_meta["available"] = False
        cache_meta["status"] = "parser_outdated"
    result["cache_meta"] = cache_meta or {
        "available": False,
        "stale": False,
        "numero_licitacion": numero,
    }

    return {"status": "success", **_radar_json_safe(result)}

@app.post("/api/v1/radar/{licitacion_id}/analizar-rfq")
def radar_analizar_rfq_historico(
    licitacion_id: int,
    limit: int = Query(12, ge=1, le=50),
    force: bool = Query(False),
    _token: str = Depends(verify_internal_token),
    session: Dict[str, Any] = Depends(verify_session_token),
):
    role = str(session.get("r") or "").strip()
    if role not in {"Supervisor", "Gerencia", "Analista"}:
        raise HTTPException(status_code=403, detail="Tu rol no tiene acceso al analisis profundo del Radar.")

    initial = db.get_radar_historico_matches(licitacion_id, limit=limit)
    if initial is None:
        raise HTTPException(status_code=404, detail="Licitacion del radar no encontrada.")
    numero = (initial.get("radar") or {}).get("numero_licitacion")
    if not numero:
        raise HTTPException(status_code=400, detail="La licitacion no tiene un numero SLI valido.")

    cache = db.get_radar_document_analysis(licitacion_id)
    if cache and cache.get("available") and _radar_parser_cache_current(cache) and not cache.get("stale") and not force:
        result = db.get_radar_historico_matches(licitacion_id, limit=limit, sli_detail=cache.get("result") or {})
    else:
        sli_detail = _consultar_sli_visible_detail_for_radar(str(numero))
        db.save_radar_document_analysis(
            licitacion_id,
            sli_detail,
            analyzed_by=str(session.get("u") or "frontend"),
        )
        cache = db.get_radar_document_analysis(licitacion_id)
        result = db.get_radar_historico_matches(licitacion_id, limit=limit, sli_detail=sli_detail)

    result["cache_meta"] = {
        key: value for key, value in (cache or {}).items() if key != "result"
    }

    return {"status": "success", **_radar_json_safe(result)}

@app.get("/")
def estado():
    return {"status": "Online", "engine": "Proyelec Core v6.1 - Token Optimized"}

@app.get("/api/v1/health")
def api_health():
    return {
        "status": "ok",
        "database_configured": bool(os.getenv("DATABASE_URL")),
        "frontend_origin_configured": bool(FRONTEND_ORIGIN),
        "internal_token_configured": bool(INTERNAL_API_TOKEN and INTERNAL_API_TOKEN != "default-dev-token"),
    }

# --- 4. PROMPT ANALISTA DE PLIEGOS (Multi-documento) ---
PROMPT_ANALISTA_MULTI = """
Eres un Analista Senior de Procura. Analiza TODO el conjunto de documentos proporcionados (Pliego Principal y Anexos Técnicos).
Cruza la información de todos los documentos para obtener descripciones técnicas exactas.

REGLA DE ORO ESTRICTA:
Tu análisis debe basarse ÚNICA Y EXCLUSIVAMENTE en el texto, tablas y datos contenidos en los documentos adjuntos.
No busques información en internet, no deduzcas, no asumas y no uses conocimiento externo sobre leyes, fabricantes, estándares o prácticas comerciales.
Si un dato no aparece explícitamente en los documentos, devuelve exactamente: "No especificado en los documentos adjuntos".

IMPORTANTE: El campo 'ficha_tecnica_completa' debe ser redactado como una checklist técnica. Lista todos los requerimientos, materiales, normativas y entregables que exige la ACP para ese renglón usando el formato '- [ ] Requisito'.
IMPORTANTE: No confundas 'ficha_tecnica_completa' con 'requiere_ficha_tecnica'. 
- 'ficha_tecnica_completa' resume las especificaciones técnicas del producto/renglón.
- 'requiere_ficha_tecnica' solo indica si el oferente debe ENTREGAR/ADJUNTAR un documento técnico en la oferta.

Extrae también controles técnicos críticos para decidir participación:
- restriccion_marca_proveedor: Si el pliego exige o restringe explícitamente a una marca, fabricante, suplidor, proponente o distribuidor autorizado que no sea la ACP, descríbelo aquí (ej. 'Solo se acepta marca X' o 'Solo distribuidor autorizado Y'). Si no hay restricciones, devuelve null.
- permite_equivalentes: true si el pliego permite marcas/modelos equivalentes, alternativas técnicas o "igual o superior"; false si exige una marca/modelo exacto sin alternativas; null si no se puede determinar.
- permite_carta_obsolescencia: true si el pliego (usualmente en el Inciso 9 o similar) permite entregar actualizaciones de números de parte obsoletos acompañadas de una carta del fabricante, false si no.
- evidencia_restricciones: cita corta o referencia de la cláusula/inciso donde se detectó restricción, equivalentes, carta de fabricante u obsolescencia. Si no aplica, devuelve "".
- riesgo_tecnico_global: "Bajo", "Medio" o "Alto" según restricciones de marca/proveedor, falta de equivalentes, fichas técnicas obligatorias y riesgo de obsolescencia.
- propuesta_tecnica_requerida: "Si" si el pliego exige adjuntar propuesta técnica; "No" si explícitamente no la exige; "No especificado en los documentos adjuntos" si no se menciona. Si aplica solo a ciertos renglones, devuelve "Si (aplica solo a líneas X, Y)".
- propuesta_tecnica_aplica_renglones: lista de renglones/líneas donde aplica la propuesta técnica. Si aplica globalmente, usa ["Todos"]. Si no se especifica, [].
- evidencia_propuesta_tecnica: cita corta exacta donde se pide la propuesta técnica y se indica a qué líneas aplica.
- persona_encargada_licitacion: nombre del agente de compras, contacto, responsable o persona encargada de la licitación si aparece en el documento. Si no aparece, devuelve "No especificado en los documentos adjuntos".
- correo_encargado_licitacion: correo electrónico del contacto de la licitación si aparece. Si no aparece, devuelve "No especificado en los documentos adjuntos".
- telefono_encargado_licitacion: teléfono del contacto de la licitación si aparece. Si no aparece, devuelve "No especificado en los documentos adjuntos".
- requiere_presencia_local: true si el pliego exige explícitamente empresa local, presencia local, oficina local, representante local o condición similar para participar; false si no se detecta ese requisito en los documentos o el pliego permite participar sin esa condición; null si el texto es contradictorio o no se puede determinar.
- evidencia_presencia_local: cita corta exacta donde se detecta el requisito de presencia local o la ausencia/permiso relevante. Si no hay evidencia textual clara, devuelve "".
- empresa_recomendada_participacion: "EP" si requiere_presencia_local es true; "Proyelec" si requiere_presencia_local es false; "Validar" si requiere_presencia_local es null.

Para cada renglón extrae:
- codigo_articulo: código ACP del renglón ÚNICAMENTE si aparece con formato de 3 letras, guion, 3 letras, guion y 5 números, por ejemplo ABC-DEF-12345. No incluyas descripciones, números de parte, marcas ni texto adicional. Si el código no aparece con ese formato exacto, devuelve "".
- El código ACP aparece al INICIO de la descripción del renglón. Ejemplo: si el renglón comienza "PWR-BAT-00009 ...", devuelve codigo_articulo="PWR-BAT-00009". Si el renglón no comienza con ese patrón exacto, devuelve "". "S/C" significa sin código y nunca es un código ACP.
- requiere_propuesta_tecnica: true si la propuesta técnica aplica a ese renglón/línea; false si no aplica.
- requiere_ficha_tecnica: true SOLO si el pliego exige entregar/presentar/adjuntar ficha técnica, catálogo, datasheet, plano, certificado, muestra, manual, ficha de seguridad o submittal técnico junto con la oferta/propuesta. false si el texto solo describe especificaciones técnicas, marca, modelo, número de parte o cumplimiento técnico sin pedir un documento entregable.
- marca_modelo_requerido: marca, fabricante, modelo o número de parte exigido para ese renglón. Si no hay, null.
- acepta_equivalente: true si ese renglón acepta equivalente; false si no acepta; null si no se puede determinar.
- posible_obsolescencia: true si el texto menciona número de parte obsoleto, reemplazo, actualización, discontinued, superseded, obsolete o carta del fabricante para ese renglón; false si no.
- evidencia_tecnica: cita corta o inciso relevante para ficha técnica, marca/modelo, equivalentes u obsolescencia de ese renglón.

Regla especial para 'requiere_ficha_tecnica':
- NO marques true solo porque exista una marca restringida.
- NO marques true solo porque exista número de parte, modelo, material, dimensión, norma o especificación técnica.
- Marca true únicamente si el documento exige un ENTREGABLE DOCUMENTAL como "presentar ficha técnica", "adjuntar catálogo", "entregar datasheet", "certificado", "manual", "carta del fabricante", "plano", "muestra" o frase equivalente.
- Si la evidencia no contiene una exigencia documental clara, requiere_ficha_tecnica debe ser false.

Regla especial para 'requiere_propuesta_tecnica':
- Si el documento dice "Se requiere propuesta técnica" y luego limita con frases como "(APLICA SOLO PARA LAS LÍNEAS 3 Y 4)", marca true únicamente en esos renglones.
- No confundas "propuesta técnica" con "marca restringida". Una licitación puede permitir alternativas técnicas y aun así exigir propuesta técnica para comprobar cumplimiento.
- Si la propuesta técnica debe incluir marca/modelo/dimensiones para líneas específicas, eso es requiere_propuesta_tecnica=true para esas líneas, no necesariamente requiere_ficha_tecnica=true.

Responde ÚNICAMENTE con el siguiente JSON estricto, sin texto adicional:
{"condiciones_generales": {"numero_licitacion": "", "tiempo_de_entrega_global": "", "garantia_exigida": "", "lugar_de_entrega": "", "validez_de_la_oferta": "", "persona_encargada_licitacion": "No especificado en los documentos adjuntos", "correo_encargado_licitacion": "No especificado en los documentos adjuntos", "telefono_encargado_licitacion": "No especificado en los documentos adjuntos", "requiere_presencia_local": null, "evidencia_presencia_local": "", "empresa_recomendada_participacion": "Validar", "propuesta_tecnica_requerida": "Si/No/No especificado en los documentos adjuntos", "propuesta_tecnica_aplica_renglones": [], "evidencia_propuesta_tecnica": "", "restriccion_marca_proveedor": null, "permite_equivalentes": null, "permite_carta_obsolescencia": false, "evidencia_restricciones": "", "riesgo_tecnico_global": "Bajo"},
 "items": [{"renglon": "", "codigo_articulo": "", "cantidad": 0, "unidad_de_medida": "", "ficha_tecnica_completa": "", "termino_de_busqueda_corto": "", "requiere_propuesta_tecnica": false, "requiere_ficha_tecnica": false, "marca_modelo_requerido": null, "acepta_equivalente": null, "posible_obsolescencia": false, "evidencia_tecnica": ""}]}
"""

DOCUMENTAL_KEYWORDS = [
    "presentar ficha", "adjuntar ficha", "entregar ficha", "ficha tecnica", "ficha técnica",
    "catalogo", "catálogo", "datasheet", "data sheet", "certificado", "certificacion",
    "certificación", "manual", "carta del fabricante", "carta de fabricante", "plano",
    "muestra", "submittal", "hoja de seguridad", "ficha de seguridad", "msds",
]

ACP_CODE_RE = re.compile(r"([A-Z]{3})-([A-Z]{3})-(\d{5})", re.IGNORECASE)
ACP_CODE_AT_ITEM_START_RE = re.compile(
    r"^\s*([A-Z]{3}-[A-Z]{3}-\d{5})(?=$|[\s|:;,])",
    re.IGNORECASE,
)

def _normalize_acp_code(value):
    text = str(value or "").strip().upper()
    match = ACP_CODE_RE.fullmatch(text)
    if not match:
        return ""
    return f"{match.group(1).upper()}-{match.group(2).upper()}-{match.group(3)}"

def _extract_item_start_acp_code(item, allowed_codes=None):
    """Recupera el código solo desde campos que representan el inicio del renglón."""
    if not isinstance(item, dict):
        return ""

    allowed = None if allowed_codes is None else {
        normalized
        for value in allowed_codes
        if (normalized := _normalize_acp_code(value))
    }

    def is_allowed(code):
        return bool(code and (allowed is None or code in allowed))

    explicit_code = _normalize_acp_code(item.get("codigo_articulo"))
    if is_allowed(explicit_code):
        return explicit_code

    for key in ["termino_de_busqueda_corto", "descripcion", "detalle", "nombre_articulo"]:
        text = str(item.get(key) or "").strip()
        match = ACP_CODE_AT_ITEM_START_RE.match(text)
        code = match.group(1).upper() if match else ""
        if is_allowed(code):
            return code
    return ""

def _parse_rows_from_scope_text(value):
    rows = set()
    if value is None:
        return rows, False
    if isinstance(value, (list, tuple, set)):
        all_rows = False
        for item in value:
            item_text = str(item or "").strip().lower()
            if item_text in ["todos", "todas", "all"]:
                all_rows = True
            rows.update(re.findall(r"\d+", item_text))
        return rows, all_rows

    text = str(value or "").strip()
    if not text:
        return rows, False
    if re.search(r"\b(todos|todas|global|all)\b", text, re.IGNORECASE):
        return rows, True

    scoped_matches = re.findall(
        r"(:l[ií]neas|renglones)\s+([0-9][0-9,\s\-yY]*)",
        text,
        flags=re.IGNORECASE,
    )
    for match in scoped_matches:
        rows.update(re.findall(r"\d+", match))
    return rows, False

def _to_bool(value, default=False):
    if isinstance(value, bool):
        return value
    if value is None:
        return default
    text = str(value).strip().lower()
    if text in ["true", "si", "sí", "yes", "1"]:
        return True
    if text in ["false", "no", "0", "none", "null", "n/a", ""]:
        return False
    return default

def _to_optional_bool(value):
    if isinstance(value, bool):
        return value
    if value is None:
        return None
    text = str(value).strip().lower()
    if text in ["true", "si", "sí", "yes", "1"]:
        return True
    if text in ["false", "no", "0"]:
        return False
    return None

def postprocess_technical_analysis(data: dict, source_documents=None) -> dict:
    """Reduce falsos positivos entre especificaciones técnicas y entregables documentales."""
    items = data.get("items", []) if isinstance(data, dict) else []
    source_documents = source_documents or []
    source_text_available = any(
        str(page.get("texto") or "").strip()
        for document in source_documents
        for page in (document.get("paginas") or [])
    )
    source_items = _extract_radar_items_from_documents(source_documents, limit=500) if source_text_available else []
    source_acp_codes = {
        str(item.get("codigo_articulo") or "").upper()
        for item in source_items
        if item.get("codigo_articulo")
    }
    proposal_rows = []
    for item in items:
        if not isinstance(item, dict):
            continue
        # Si el PDF tiene texto legible, el codigo debe existir en una fila real
        # del documento. Esto impide que la IA reutilice o invente codigos ACP.
        item["codigo_articulo"] = _extract_item_start_acp_code(
            item,
            allowed_codes=source_acp_codes if source_text_available else None,
        )
        requiere_propuesta = _to_bool(item.get("requiere_propuesta_tecnica"), default=False)
        item["requiere_propuesta_tecnica"] = requiere_propuesta
        if requiere_propuesta:
            renglon = str(item.get("renglon") or "").strip()
            if renglon:
                proposal_rows.append(renglon)

        requiere = _to_bool(item.get("requiere_ficha_tecnica"), default=False)
        evidencia = str(item.get("evidencia_tecnica") or "").lower()
        combined = evidencia

        has_documental_evidence = any(keyword in combined for keyword in DOCUMENTAL_KEYWORDS)
        if requiere and not has_documental_evidence:
            item["requiere_ficha_tecnica"] = False
            if evidencia:
                item["evidencia_tecnica"] = f"{item.get('evidencia_tecnica')} | Nota del sistema: no se detectó un entregable documental explícito."
            else:
                item["evidencia_tecnica"] = "No especificado en los documentos adjuntos"
        else:
            item["requiere_ficha_tecnica"] = requiere

        item["posible_obsolescencia"] = _to_bool(item.get("posible_obsolescencia"), default=False)

    cg = data.get("condiciones_generales", {}) if isinstance(data, dict) else {}
    if isinstance(cg, dict):
        scope_rows, scope_all = _parse_rows_from_scope_text(cg.get("propuesta_tecnica_aplica_renglones"))
        text_scope_rows, text_scope_all = _parse_rows_from_scope_text(
            f"{cg.get('propuesta_tecnica_requerida', '')} {cg.get('evidencia_propuesta_tecnica', '')}"
        )
        scope_rows.update(text_scope_rows)
        scope_all = scope_all or text_scope_all
        proposal_required = str(cg.get("propuesta_tecnica_requerida", "") or "").strip().lower().startswith(("si", "sí")) or bool(scope_rows) or scope_all

        if proposal_required and (scope_all or scope_rows):
            proposal_rows = []
            for item in items:
                if not isinstance(item, dict):
                    continue
                renglon = str(item.get("renglon") or "").strip()
                row_number_match = re.search(r"\d+", renglon)
                row_number = row_number_match.group(0) if row_number_match else ""
                applies = scope_all or row_number in scope_rows
                item["requiere_propuesta_tecnica"] = bool(applies)
                if applies and row_number:
                    proposal_rows.append(row_number)
            if scope_rows:
                proposal_rows = sorted(set(scope_rows), key=lambda x: int(x) if x.isdigit() else x)
            elif scope_all:
                cg["propuesta_tecnica_requerida"] = "Si (aplica a todos los renglones)"
                cg["propuesta_tecnica_aplica_renglones"] = ["Todos"]
        if proposal_rows:
            unique_rows = sorted(set(proposal_rows), key=lambda x: int(x) if x.isdigit() else x)
            cg["propuesta_tecnica_requerida"] = f"Si (aplica a las líneas {', '.join(unique_rows)})"
            cg["propuesta_tecnica_aplica_renglones"] = unique_rows
        elif str(cg.get("propuesta_tecnica_requerida", "")).strip().lower() in ["", "n/a", "none", "null"]:
            cg["propuesta_tecnica_requerida"] = "No especificado en los documentos adjuntos"

        for key in [
            "persona_encargada_licitacion",
            "correo_encargado_licitacion",
            "telefono_encargado_licitacion",
        ]:
            if str(cg.get(key, "") or "").strip().lower() in ["", "n/a", "none", "null"]:
                cg[key] = "No especificado en los documentos adjuntos"

        presencia_local = _to_optional_bool(cg.get("requiere_presencia_local"))
        cg["requiere_presencia_local"] = presencia_local
        if presencia_local is True:
            cg["empresa_recomendada_participacion"] = "EP"
        elif presencia_local is False:
            cg["empresa_recomendada_participacion"] = "Proyelec"
        else:
            cg["empresa_recomendada_participacion"] = "Validar"
            if str(cg.get("evidencia_presencia_local", "") or "").strip().lower() in ["n/a", "none", "null"]:
                cg["evidencia_presencia_local"] = ""

    return data

def extract_supplier_file_text(filename, content):
    """Extrae texto simple de propuestas no PDF para pasarlo a la IA."""
    name = str(filename or "").lower()
    try:
        if name.endswith(".txt"):
            return content.decode("utf-8", errors="ignore")[:40000]
        if name.endswith(".csv"):
            return content.decode("utf-8", errors="ignore")[:40000]
        if name.endswith((".xlsx", ".xls")):
            sheets = pd.read_excel(io.BytesIO(content), sheet_name=None, dtype=str)
            chunks = []
            for sheet_name, df in sheets.items():
                df = df.fillna("")
                chunks.append(f"Hoja: {sheet_name}\n{df.head(250).to_csv(index=False)}")
            return "\n\n".join(chunks)[:50000]
        if name.endswith(".docx"):
            with zipfile.ZipFile(io.BytesIO(content)) as zf:
                xml_bytes = zf.read("word/document.xml")
            root = ET.fromstring(xml_bytes)
            ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
            texts = [node.text for node in root.findall(".//w:t", ns) if node.text]
            return "\n".join(texts)[:50000]
    except Exception as exc:
        logger.warning(f"No se pudo extraer texto de {filename}: {exc}")
    return ""

def build_supplier_proposal_prompt(items, cg, extracted_texts, supplier_name="", evaluation_notes=""):
    compact_items = []
    for item in items[:80]:
        if not isinstance(item, dict):
            continue
        compact_items.append({
            "renglon": item.get("renglon", ""),
            "codigo_articulo": item.get("codigo_articulo", ""),
            "cantidad": item.get("cantidad", ""),
            "unidad_de_medida": item.get("unidad_de_medida", ""),
            "descripcion": item.get("termino_de_busqueda_corto", ""),
            "especificaciones_tecnicas": str(item.get("ficha_tecnica_completa", ""))[:1800],
            "marca_modelo_requerido": item.get("marca_modelo_requerido", ""),
            "acepta_equivalente": item.get("acepta_equivalente", None),
            "requiere_propuesta_tecnica": item.get("requiere_propuesta_tecnica", False),
            "requiere_ficha_tecnica": item.get("requiere_ficha_tecnica", False),
            "evidencia_tecnica": str(item.get("evidencia_tecnica", ""))[:1200],
            "restriccion_detectada": item.get("restriccion_detectada", item.get("restriccion_marca", "")),
            "requiere_carta_fabricante": item.get("requiere_carta_fabricante", False),
            "observaciones": str(item.get("observaciones", ""))[:1200],
        })

    return f"""
Actúa como Especialista Senior en Evaluación Técnica de propuestas de proveedores para licitaciones ACP.

REGLA DE ORO:
- Evalúa ÚNICAMENTE con base en los renglones técnicos del pliego y la propuesta del proveedor adjunta o extraída.
- No busques en internet.
- No asumas cumplimiento. Si la propuesta no evidencia el dato, marca "No encontrado".
- Si cumple una parte pero falta un dato crítico, marca "Cumple parcialmente".
- Si contradice el requisito o no cumple una condición obligatoria, marca "No cumple".
- Si cumple con evidencia clara, marca "Cumple".
- Genera una fila por cada requisito tecnico verificable, no una sola fila resumen por renglon.
- Separa dimensiones, material, capacidad, marca/modelo, norma, certificacion, documentacion y plazo cuando sean requisitos independientes.
- Cita el nombre del documento y la pagina cuando puedan identificarse.

Contexto general de la licitación:
INSTRUCCION SOBRE ANEXOS Y ENMIENDAS:
- Si hay notas de anexos, enmiendas, aclaraciones o cambios posteriores, trátalas como fuente prioritaria frente al RFQ original.
- Si una enmienda cambia marca, modelo, cantidad, fecha, especificación, ficha técnica, carta de fabricante o forma de presentación, refléjalo en "faltante_o_riesgo".

Proveedor evaluado:
{supplier_name or "No especificado"}

Notas de anexos, enmiendas, aclaraciones o contexto adicional:
{evaluation_notes or "No especificado en el contexto disponible"}

{json.dumps(cg or {}, ensure_ascii=False, indent=2)[:6000]}

Renglones técnicos ACP a evaluar:
{json.dumps(compact_items, ensure_ascii=False, indent=2)}

Texto extraído de archivos no PDF de la propuesta:
{json.dumps(extracted_texts, ensure_ascii=False, indent=2)[:50000]}

Devuelve SOLO JSON válido con esta estructura:
{{
  "resumen": "Resumen ejecutivo breve del nivel de cumplimiento del proveedor",
  "evaluaciones": [
    {{
      "renglon": "número de renglón",
      "codigo_articulo": "código ACP si aplica",
      "descripcion": "descripción corta",
      "resultado": "Cumple/No cumple/Cumple parcialmente/No encontrado",
      "confianza": "Alta/Media/Baja",
      "requisito_acp": "requisito técnico principal evaluado",
      "oferta_proveedor": "qué ofrece o declara el proveedor",
      "evidencia": "cita o referencia concreta dentro de la propuesta",
      "documento_fuente": "nombre exacto del archivo donde aparece la evidencia",
      "pagina_fuente": "numero de pagina si se identifica; vacio si no",
      "faltante_o_riesgo": "qué falta validar, pedir o corregir",
      "accion_sugerida": "Aceptar/Pedir aclaración/Rechazar/Revisar manualmente"
    }}
  ]
}}
"""

def parse_supplier_evaluation_response(text):
    raw = str(text or "").strip().replace("```json", "").replace("```", "").strip()
    try:
        data = json.loads(raw)
    except Exception:
        start = raw.find("{")
        end = raw.rfind("}")
        if start >= 0 and end > start:
            data = json.loads(raw[start:end + 1])
        else:
            raise
    if not isinstance(data, dict):
        return {"resumen": "", "evaluaciones": []}
    allowed = {"Cumple", "No cumple", "Cumple parcialmente", "No encontrado"}
    rows = []
    for item in data.get("evaluaciones", []) or []:
        if not isinstance(item, dict):
            continue
        resultado = str(item.get("resultado", "No encontrado") or "No encontrado").strip()
        if resultado not in allowed:
            resultado = "No encontrado"
        rows.append({
            "renglon": item.get("renglon", ""),
            "codigo_articulo": item.get("codigo_articulo", ""),
            "descripcion": item.get("descripcion", ""),
            "resultado": resultado,
            "confianza": item.get("confianza", "Media"),
            "requisito_acp": item.get("requisito_acp", ""),
            "oferta_proveedor": item.get("oferta_proveedor", ""),
            "evidencia": item.get("evidencia", ""),
            "documento_fuente": item.get("documento_fuente", ""),
            "pagina_fuente": item.get("pagina_fuente", ""),
            "faltante_o_riesgo": item.get("faltante_o_riesgo", ""),
            "accion_sugerida": item.get("accion_sugerida", "Revisar manualmente"),
        })
    return {"resumen": data.get("resumen", ""), "evaluaciones": rows}

@app.post("/api/v1/analizar-pliego")
async def analizar_pliego(
    archivos_pdf: List[UploadFile] = File(...),
    gemini_key: str = Form(""),
    username: str = Form("API"),
    role: str = Form(""),
    supplier_name: str = Form(""),
    evaluation_notes: str = Form(""),
    _token: str = Depends(verify_internal_token)
):
    started_at = time.perf_counter()
    api_key_clean = _resolve_gemini_key(username, gemini_key)
    if not api_key_clean:
        raise HTTPException(status_code=400, detail="Configura Gemini API Key en Admin o en el perfil del usuario.")
    client = None
    local_temp_files = []
    archivos_subidos = []
    source_documents = []
    try:
        client = get_gemini_client(api_key_clean)

        for archivo in archivos_pdf:
            tmp_path = await save_upload_to_runtime_file(archivo, suffix=".pdf", validate_pdf=True)
            local_temp_files.append(tmp_path)
            source_documents.append({
                "nombre": archivo.filename or os.path.basename(tmp_path),
                "url": "",
                "tipo": "rfq_pdf_subido",
                "paginas": extract_pdf_pages_from_path(tmp_path),
            })
            uploaded_file = gemini_upload_file(client, tmp_path)
            archivos_subidos.append(uploaded_file)

        # gemini-2.5-flash para análisis complejo de PDFs
        response, used_model = gemini_generate_with_fallback(
            client,
            [PROMPT_ANALISTA_MULTI, *archivos_subidos],
            response_mime_type="application/json",
        )
        try:
            db.log_ai_usage(
                username=username,
                role=role,
                action="analizar_pliego",
                model=used_model,
                usage_metadata=response.usage_metadata,
                duration_ms=int((time.perf_counter() - started_at) * 1000),
                metadata={"pdf_count": len(archivos_subidos)}
            )
        except Exception as e:
            logger.warning(f"Error logging metric: {e}")

        logger.info(f"{len(archivos_subidos)} pliego(s) analizados exitosamente.")
        data = json.loads(response.text)
        return postprocess_technical_analysis(data, source_documents=source_documents)

    except Exception as e:
        logger.exception("Error analizando pliego")
        detail = user_friendly_external_error(e, context="Gemini")
        db.log_usage_event(
            username=username,
            role=role,
            module="ai",
            action="analizar_pliego",
            provider="gemini",
            model=GEMINI_MODEL,
            status="error",
            error_message=detail[:500],
            duration_ms=int((time.perf_counter() - started_at) * 1000),
            metadata={"pdf_count": len(archivos_pdf)}
        )
        raise HTTPException(status_code=503 if is_windows_network_filter_error(e) else 500, detail=detail)
    finally:
        if client is not None:
            for f in archivos_subidos:
                gemini_delete_file(client, f)
        for tmp_path in local_temp_files:
            safe_remove_file(tmp_path)

@app.post("/api/v1/evaluar-propuesta")
async def evaluar_propuesta_proveedor(
    archivos_propuesta: List[UploadFile] = File(...),
    items_json: str = Form(...),
    cg_json: str = Form("{}"),
    gemini_key: str = Form(""),
    username: str = Form("API"),
    role: str = Form(""),
    supplier_name: str = Form(""),
    evaluation_notes: str = Form(""),
    _token: str = Depends(verify_internal_token)
):
    started_at = time.perf_counter()
    api_key_clean = _resolve_gemini_key(username, gemini_key)
    if not api_key_clean:
        raise HTTPException(status_code=400, detail="Configura Gemini API Key en Admin o en el perfil del usuario.")
    uploaded_files = []
    temp_paths = []
    extracted_texts = []
    client = None
    try:
        items = json.loads(items_json)
        cg = json.loads(cg_json or "{}")
        if not isinstance(items, list) or not items:
            raise HTTPException(status_code=400, detail="No hay renglones técnicos para evaluar.")

        client = get_gemini_client(api_key_clean)

        for archivo in archivos_propuesta:
            content = await archivo.read()
            filename = archivo.filename or "propuesta"
            suffix = os.path.splitext(filename)[1] or ".pdf"
            if filename.lower().endswith(".pdf"):
                with tempfile.NamedTemporaryFile(delete=False, suffix=suffix, dir=RUNTIME_UPLOAD_DIR) as tmp:
                    if content[:4] != b"%PDF":
                        raise ValueError(f"El archivo {filename} no parece ser un PDF valido.")
                    tmp.write(content)
                    tmp_path = tmp.name
                temp_paths.append(tmp_path)
                uploaded_files.append(gemini_upload_file(client, tmp_path))
            else:
                extracted = extract_supplier_file_text(filename, content)
                extracted_texts.append({
                    "archivo": filename,
                    "texto": extracted or "No se pudo extraer texto útil del archivo."
                })

        if not uploaded_files and not any(t.get("texto") for t in extracted_texts):
            raise HTTPException(status_code=400, detail="No se pudo leer la propuesta del proveedor.")

        prompt = build_supplier_proposal_prompt(
            items,
            cg,
            extracted_texts,
            supplier_name=supplier_name,
            evaluation_notes=evaluation_notes,
        )
        contents = [prompt, *uploaded_files] if uploaded_files else [prompt]
        response, used_model = gemini_generate_with_fallback(
            client,
            contents,
            response_mime_type="application/json",
        )
        parsed = parse_supplier_evaluation_response(response.text)

        elapsed_ms = int((time.perf_counter() - started_at) * 1000)
        tokens_input, tokens_output, tokens_total = db.extract_usage_counts(getattr(response, "usage_metadata", None))
        db.log_usage_event(
            username=username,
            role=role,
            module="evaluacion",
            action="evaluar_propuesta_proveedor",
            licitacion=str(cg.get("numero_licitacion", "")) if isinstance(cg, dict) else "",
            provider="gemini",
            model=used_model,
            tokens_input=tokens_input,
            tokens_output=tokens_output,
            tokens_total=tokens_total,
            status="success",
            duration_ms=elapsed_ms,
            metadata={
                "cost_accuracy": "input_output_tokens",
                "items": len(items),
                "archivos": len(archivos_propuesta),
                "supplier": supplier_name,
            }
        )
        return {"status": "success", "model": used_model, **parsed}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Error evaluando propuesta proveedor")
        detail = user_friendly_external_error(e, context="Gemini")
        db.log_usage_event(
            username=username,
            role=role,
            module="evaluacion",
            action="evaluar_propuesta_proveedor",
            provider="gemini",
            model=GEMINI_MODEL,
            status="error",
            error_message=detail[:500],
            duration_ms=int((time.perf_counter() - started_at) * 1000),
        )
        raise HTTPException(status_code=503 if is_windows_network_filter_error(e) else 500, detail=detail)
    finally:
        if client is not None:
            for uploaded in uploaded_files:
                gemini_delete_file(client, uploaded)
        for path in temp_paths:
            safe_remove_file(path)

# --- 5. FUNCIONES DE APOYO PARA CORREOS (HILO SECUNDARIO) ---
def get_user_credentials(username):
    row = db.get_user_credentials(username)
    return (row[0], crypto.decrypt_data(row[1]), row[2]) if row else (None, None, None)

# Prompt compacto: clasifica Y extrae cotizacion en una sola llamada (cero tokens extra)
PROMPT_CLASIFICADOR_CORREOS = """Eres un asistente de procura. Analiza este correo en relacion a la licitacion {licitacion}.
Items de referencia: {contexto_items_resumido}

Correo:
Asunto: {asunto}\nRemitente: {remitente}\nCuerpo: {cuerpo}

Responde SOLO con este JSON (sin texto adicional):
{{"relacionado": true/false,
  "resumen": "1 linea de lo que ofrece el proveedor",
  "renglones": "numeros separados por coma ej: 1, 3",
  "borrador_respuesta": "correo de respuesta profesional firmado como Departamento de Compras",
  "cotizaciones": [
    {{"renglon": "1", "precio_unitario": 0.0, "moneda": "USD", "tiempo_entrega": "30 dias", "condiciones": "FOB"}}
  ]
}}
Si el correo no contiene precios, devuelve cotizaciones como lista vacia [].
"""

def procesar_correos_background(username: str, servidor_imap: str, licitacion_activa: str, contexto_items: str):
    email_user, email_pass, gemini_key = get_user_credentials(username)
    if not email_user or not email_pass:
        logger.warning(f"Sin credenciales de correo para usuario {username}")
        return

    try:
        client = get_gemini_client(gemini_key)
        # gemini-2.5-flash para clasificación simple de correos

        # Reducir contexto enviado: solo los 3 campos clave, NO la ficha técnica completa
        try:
            df_items = pd.read_json(io.StringIO(contexto_items))
            cols_disponibles = [c for c in ['renglon', 'codigo_articulo', 'termino_de_busqueda_corto'] if c in df_items.columns]
            contexto_resumido = df_items[cols_disponibles].to_json(orient="records", force_ascii=False)
        except Exception:
            contexto_resumido = contexto_items[:500]  # fallback seguro

        mail = imaplib.IMAP4_SSL(servidor_imap)
        mail.login(email_user, email_pass)
        mail.select("inbox")

        status, mensajes = mail.search(None, 'ALL')
        if not mensajes[0]:
            return

        # Evaluamos los últimos 50 correos, pero enviaremos máximo 15 a Gemini
        lista_ids = mensajes[0].split()[-50:]
        correos_enviados_a_gemini = 0

        for id_correo in lista_ids:
            if correos_enviados_a_gemini >= 15:
                break
            res, data = mail.fetch(id_correo, '(RFC822)')
            for part in data:
                if isinstance(part, tuple):
                    msg = email.message_from_bytes(part[1])
                    subj_raw = decode_header(msg.get("Subject", ""))[0]
                    asunto = subj_raw[0].decode(subj_raw[1] or 'utf-8', errors='ignore') if isinstance(subj_raw[0], bytes) else str(subj_raw[0])
                    remitente = msg.get("From", "Desconocido")

                    if db.check_email_exists(licitacion_activa, asunto, remitente):
                        continue

                    # Pre-filtro inteligente y ahorrador de tokens:
                    num_lic_clean = "".join(re.findall(r'\d+', licitacion_activa))
                    
                    # Evitar procesar correos automáticos o spam obvio
                    if "no-reply" in remitente.lower() or "newsletter" in remitente.lower() or "marketing" in remitente.lower():
                        continue

                    # Extraer el cuerpo antes para poder filtrarlo
                    cuerpo_crudo = ""
                    if msg.is_multipart():
                        for p in msg.walk():
                            if p.get_content_type() == "text/plain":
                                cuerpo_crudo += p.get_payload(decode=True).decode(errors='ignore')
                    else:
                        cuerpo_crudo = msg.get_payload(decode=True).decode(errors='ignore')

                    cuerpo_limpio = " ".join(cuerpo_crudo.split())
                    
                    # Chequeo flexible: Si menciona el número de licitación o tiene palabras clave de B2B
                    # Busca tanto en el Asunto como en los primeros 300 caracteres del correo
                    texto_busqueda = (asunto + " " + cuerpo_limpio[:300]).upper()
                    palabras_clave = ["RFQ", "COTIZA", "QUOTE", "PROCURA", "PRECIO", "OFERTA", "SUMINISTRO", "USD", "$", "ATTACH", "ADJUNT", "REQUIREMENT", "TECH", "ESPECIFICACION", "DELIVERY", "ENTREGA"]
                    
                    es_relevante = (num_lic_clean in texto_busqueda) or (any(p in texto_busqueda for p in palabras_clave))
                    
                    if not es_relevante:
                        continue

                    # Limitar cuerpo a 1200 chars (antes 2000) - ahorra 40% de tokens de Gemini
                    cuerpo_ia = cuerpo_limpio[:1200]

                    prompt = PROMPT_CLASIFICADOR_CORREOS.format(
                        licitacion=licitacion_activa,
                        contexto_items_resumido=contexto_resumido,
                        asunto=asunto,
                        remitente=remitente,
                        cuerpo=cuerpo_ia
                    )

                    try:
                        time.sleep(6)  # 6s entre llamadas; respeta 15 RPM de Gemini Free
                        res_ia, _ = gemini_generate_with_fallback(client, prompt)
                        correos_enviados_a_gemini += 1
                        texto_ia = res_ia.text.strip().replace("```json", "").replace("```", "").strip()
                        datos_ia = json.loads(texto_ia)

                        if datos_ia.get("relacionado"):
                            db.insert_smart_inbox(
                                licitacion_activa, remitente, asunto,
                                msg.get("Date"), datos_ia.get('resumen', ''),
                                datos_ia.get('renglones', ''), cuerpo_limpio,
                                datos_ia.get('borrador_respuesta', '')
                            )
                            logger.info(f"Correo guardado: '{asunto}' para licitación {licitacion_activa}")

                            # Guardar cotizaciones extraídas (si las hay) en tabla comparador
                            for cot in datos_ia.get('cotizaciones', []):
                                renglon = str(cot.get('renglon', '')).strip()
                                proveedor = remitente
                                precio = float(cot.get('precio_unitario', 0) or 0)
                                if renglon and precio > 0:
                                    if not db.check_cotizacion_exists(licitacion_activa, renglon, proveedor):
                                        db.insert_cotizacion(
                                            licitacion_activa, renglon, proveedor,
                                            precio,
                                            str(cot.get('moneda', 'USD')),
                                            str(cot.get('tiempo_entrega', 'N/A')),
                                            str(cot.get('condiciones', '')),
                                            str(msg.get('Date', '')),
                                            asunto
                                        )
                                        logger.info(f"Cotización guardada: Renglón {renglon} | {proveedor} | ${precio}")
                    except Exception as parse_error:
                        logger.warning(f"Error procesando correo '{asunto}': {parse_error}")
                        continue

        mail.logout()
        logger.info(f"Escaneo de correos finalizado para usuario {username}.")

    except Exception as e:
        logger.error(f"Error crítico en hilo de correos: {e}")


# --- 6. ENDPOINT ASÍNCRONO DE CORREOS ---
@app.post("/api/v1/organizar-correos")
def organizar_correos(
    background_tasks: BackgroundTasks,
    username: str = Form(...),
    servidor_imap: str = Form("mail.proyelec.com"),
    licitacion_activa: str = Form(...),
    contexto_items: str = Form(...),
    _token: str = Depends(verify_internal_token)
):
    # Validar credenciales de correo sincronamente antes de lanzar la tarea
    email_user, email_pass, _ = get_user_credentials(username)
    if not email_user or not email_pass:
        db.log_usage_event(username=username, module="email", action="organizar_correos", licitacion=licitacion_activa, status="error", error_message="Credenciales de correo faltantes")
        return {"status": "error", "mensaje": "No has configurado tu correo y contraseña."}
    
    try:
        import imaplib
        mail = imaplib.IMAP4_SSL(servidor_imap, timeout=10)
        mail.login(email_user, email_pass)
        mail.logout()
    except imaplib.IMAP4.error as e:
        db.log_usage_event(username=username, module="email", action="organizar_correos", licitacion=licitacion_activa, status="error", error_message=str(e)[:500])
        return {"status": "error", "mensaje": f"Autenticación rechazada. Si usas Office 365 o Gmail, verifica si necesitas una contraseña de aplicación. Error: {e}"}
    except Exception as e:
        db.log_usage_event(username=username, module="email", action="organizar_correos", licitacion=licitacion_activa, status="error", error_message=str(e)[:500])
        return {"status": "error", "mensaje": f"No se pudo conectar al servidor IMAP '{servidor_imap}'. Revisa la dirección del servidor. Error: {e}"}

    background_tasks.add_task(procesar_correos_background, username, servidor_imap, licitacion_activa, contexto_items)
    db.log_usage_event(username=username, module="email", action="organizar_correos", licitacion=licitacion_activa, metadata={"servidor_imap": servidor_imap})
    return {"status": "success", "mensaje": "Conexión exitosa. Gemini está escaneando los correos en segundo plano."}


# --- 7. GENERADOR DE FICHAS TÉCNICAS (CON CACHÉ) ---
@app.post("/api/v1/generar-ficha")
def generar_ficha(
    username: str = Form(...),
    licitacion: str = Form(...),
    codigo_renglon: str = Form(...),
    pliego_context: str = Form(...),
    items_context: str = Form(...),
    gemini_key: str = Form(""),
    _token: str = Depends(verify_internal_token)
):
    # Verificar caché primero; si ya se generó, devolver sin gastar tokens.
    cached = db.get_ficha_cache(username, licitacion, codigo_renglon)
    if cached:
        logger.info(f"Ficha para {codigo_renglon} servida desde cache.")
        db.log_usage_event(
            username=username,
            module="ai",
            action="generar_ficha_cache",
            licitacion=licitacion,
            provider="gemini",
            model=GEMINI_MODEL,
            metadata={"codigo_renglon": codigo_renglon}
        )
        return {"status": "success", "datasheet_md": cached, "from_cache": True}

    try:
        prompt = f"""Eres un Ingeniero de Compras especializado. Genera una ficha técnica en formato Markdown para el artículo: {codigo_renglon}.
Condiciones del Pliego: {pliego_context}
Detalle del ítem: {items_context}

La ficha debe contener:
- **Título y Descripción breve**
- **Tabla de Especificaciones Técnicas**
- **Requisitos de Calidad / Certificaciones**
- **Condiciones especiales de la licitación**
Formato profesional y estructurado."""

        response = gemini_generate_content(gemini_key, prompt)
        datasheet = response.text

        # Guardar en cache para futuras consultas
        db.save_ficha_cache(username, licitacion, codigo_renglon, datasheet)
        db.log_ai_usage(
            username=username,
            action="generar_ficha",
            licitacion=licitacion,
            model=GEMINI_MODEL,
            usage_metadata=response.usage_metadata,
            metadata={"codigo_renglon": codigo_renglon}
        )
        logger.info(f"Ficha técnica generada y guardada en caché para {codigo_renglon}.")
        return {"status": "success", "datasheet_md": datasheet, "from_cache": False}

    except Exception as e:
        logger.error(f"Error generando ficha: {str(e)}")
        db.log_usage_event(
            username=username,
            module="ai",
            action="generar_ficha",
            licitacion=licitacion,
            provider="gemini",
            model=GEMINI_MODEL,
            status="error",
            error_message=str(e)[:500],
            metadata={"codigo_renglon": codigo_renglon}
        )
        raise HTTPException(status_code=500, detail=str(e))


# --- 8. ENDPOINTS REST ---
class LoginRequest(BaseModel):
    username: str
    password: str

class AdminCreateUserRequest(BaseModel):
    username: str
    password: str
    role: str

class AdminUpdateRoleRequest(BaseModel):
    role: str

class AdminResetPasswordRequest(BaseModel):
    password: str

class AdminApiKeysRequest(BaseModel):
    gemini_key: Optional[str] = None
    tavily_key: Optional[str] = None
    updated_by: str = "Admin"

class AdminUserApiKeysRequest(BaseModel):
    gemini_key: Optional[str] = None
    tavily_key: Optional[str] = None

class LogisticsCalculationRequest(BaseModel):
    username: str = ""
    licitacion: str = ""
    renglon: str = ""
    agente: str = ""
    tipo_flete: str = ""
    incoterm: str = ""
    peso_libras: float = 0
    peso_kg: float = 0
    costo_internacional: float = 0
    costo_local: float = 0
    costo_total: float = 0
    tiempo_transito_dias: int = 0
    metadata: Dict[str, Any] = {}
    peso_facturable_libras: float = 0
    peso_volumetrico_libras: float = 0
    largo: float = 0
    ancho: float = 0
    alto: float = 0
    unidad_dimensional: str = "in"
class LogisticsFreightRateRequest(BaseModel):
    agente: str
    tipo_servicio: str = "USA-Panama"
    tipo_flete: str = "Aereo"
    tarifa_por_libra: float = 0
    tiempo_transito_dias: int = 0
    minimo_envio: float = 0
    dia_corte: str = ""
    salidas: str = ""
    activo: bool = True

class LogisticsLocalRateRequest(BaseModel):
    agente: str
    destino: str = "Panama"
    tipo_flete: str = "Terrestre"
    hasta_400kg: float = 0
    kg_500_1000: float = 0
    mayor_1000kg: float = 0
    activo: bool = True

class LogisticsForwarderRequest(BaseModel):
    nombre: str
    direccion: str = ""
    observacion: str = ""
    activo: bool = True

class LogisticsAddressRequest(BaseModel):
    name: str = ""
    phone: str = ""
    address_line: str = ""
    city: str = ""
    state: str = ""
    postal_code: str = ""
    country_code: str = "US"
    residential: bool = False

class LogisticsPackageRequest(BaseModel):
    package_type: str = "02"
    quantity: int = 1
    weight: float
    weight_unit: str = "LBS"
    length: float
    width: float
    height: float
    dimension_unit: str = "IN"
    description: str = ""

class UpsQuoteRequest(BaseModel):
    username: str = ""
    origin: LogisticsAddressRequest
    destination: LogisticsAddressRequest
    packages: List[LogisticsPackageRequest]
    pickup_date: str = ""
    declared_value: float = 0
    shipper_number: str = ""
    licitacion: str = ""
    renglon: str = ""

class ShipStationQuoteRequest(UpsQuoteRequest):
    pass

class SchneiderCommodityRequest(BaseModel):
    description: str = "General freight"
    quantity: int = 1
    weight: float
    weight_unit: str = "LB"
    length: float = 0
    width: float = 0
    height: float = 0
    dimension_unit: str = "IN"
    freight_class: str = ""
    hazardous: bool = False

class SchneiderQuoteRequest(BaseModel):
    username: str = ""
    origin: LogisticsAddressRequest
    destination: LogisticsAddressRequest
    commodities: List[SchneiderCommodityRequest]
    mode: str = "LTL"
    equipment: str = ""
    services: List[str] = []
    scac: str = ""
    pickup_start: str = ""
    pickup_end: str = ""
    delivery_start: str = ""
    delivery_end: str = ""
    load_value: float = 0
    licitacion: str = ""
    renglon: str = ""

class SourcingItem(BaseModel):
    renglon: Optional[str] = ""
    codigo_acp: Optional[str] = ""
    descripcion: Optional[str] = ""
    busqueda_sugerida: Optional[str] = ""
    cantidad: Optional[str] = ""
    unidad: Optional[str] = ""
    marca_modelo: Optional[str] = ""
    acepta_equivalente: Optional[bool] = None
    requiere_propuesta_tecnica: Optional[bool] = False
    requiere_ficha_tecnica: Optional[bool] = False
    evidencia_tecnica: Optional[str] = ""
    restriccion_detectada: Optional[str] = ""
    requiere_carta_fabricante: Optional[bool] = False
    observaciones: Optional[str] = ""

class SourcingRequest(BaseModel):
    username: str
    items: List[SourcingItem]
    custom_prompt: str = ""
    depth: str = "Profunda"
    target_count: int = 10
    sourcing_strategy: str = "por_renglon"
    gemini_key: Optional[str] = None
    tavily_key: Optional[str] = None

class CompanyAuditRequest(BaseModel):
    username: str
    company_name: str
    website: str = ""
    country: str = ""
    registration_id: str = ""
    tax_id: str = ""
    contact_email: str = ""
    contact_phone: str = ""
    declared_address: str = ""
    product_context: str = ""
    notes: str = ""
    gemini_key: Optional[str] = None

class SeguimientoCreateRequest(BaseModel):
    numero_licitacion: str
    owner_username: str = ""
    objeto: str = ""
    fecha_asignacion: str = ""
    fecha_envio_oferta: str = ""
    monto_ofertado: float = 0
    moneda: str = "USD"
    link_sli: str = ""
    notas: str = ""
    responsable: str = ""

class SeguimientoEstadoRequest(BaseModel):
    estado: str
    nota: str = ""
    registrado_por: str = ""

class SeguimientoSliSnapshotRequest(BaseModel):
    snapshot: Dict[str, Any] = {}

class RfqEmailRequest(BaseModel):
    username: str
    cg: Dict[str, Any] = {}
    items: List[Dict[str, Any]] = []
    language: str = "English"
    contact_name: str = ""
    company: str = ""
    scope_label: str = "Todos los renglones"
    payment_terms: str = "Net 30 o superior"
    reply_by: str = ""
    lead_time: str = ""
    gemini_key: Optional[str] = None

class AiAdvisorRequest(BaseModel):
    username: str
    cg: Dict[str, Any] = {}
    items: List[Dict[str, Any]] = []
    situation: str
    mode: str = "Negociacion de precio"
    reference_price: float = 0
    gemini_key: Optional[str] = None

class AiCopilotRequest(BaseModel):
    username: str
    cg: Dict[str, Any] = {}
    items: List[Dict[str, Any]] = []
    question: str
    history: List[Dict[str, str]] = []
    gemini_key: Optional[str] = None

class WorkspaceSaveRequest(BaseModel):
    username: str
    licitacion: str = ""
    data: List[Dict[str, Any]] = []
    condiciones_generales: Dict[str, Any] = {}

def _resolve_gemini_key(username: str = "", explicit_key: Optional[str] = None):
    if explicit_key and explicit_key.strip():
        return explicit_key.strip()
    row = db.get_user_credentials(username) if username else None
    user_key = (row[2] if row and len(row) > 2 else "").strip()
    if user_key:
        return user_key
    global_key, _, _ = db.get_system_setting("gemini_key")
    return (global_key or "").strip()

def _items_context_text(items: list, limit_per_item=800):
    chunks = []
    for item in items[:30]:
        chunks.append(f"""
ITEM - Renglon {item.get('renglon','')} | Codigo: {item.get('codigo_articulo') or item.get('codigo_acp') or ''}
Descripcion: {item.get('termino_de_busqueda_corto') or item.get('descripcion') or ''}
Cantidad: {item.get('cantidad','')} {item.get('unidad_de_medida') or item.get('unidad') or ''}
Especificaciones tecnicas:
{str(item.get('ficha_tecnica_completa') or item.get('descripcion') or '')[:limit_per_item]}
---""")
    return "\n".join(chunks) if chunks else "Sin renglones cargados."

def _json_records(df, limit: Optional[int] = None):
    if df is None or df.empty:
        return []
    records = df.head(limit).to_dict(orient="records") if limit else df.to_dict(orient="records")
    return _radar_json_safe(records)

def _json_summary(summary: dict):
    payload = {}
    for key, value in summary.items():
        if key == "df":
            continue
        if hasattr(value, "to_dict"):
            payload[key] = _json_records(value)
        else:
            payload[key] = _radar_json_safe(value)
    return payload

def _source_norm(value):
    text = unicodedata.normalize("NFKD", str(value or ""))
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    return re.sub(r"[^a-z0-9]+", " ", text.lower()).strip()

def _source_tokens(value):
    stop = {"para", "con", "the", "and", "de", "del", "que", "una", "los", "las", "por", "from", "with"}
    return [token for token in re.findall(r"[a-z0-9]{4,}", _source_norm(value)) if token not in stop][:12]

def _sourcing_base_query(ctx: dict):
    parts = [
        ctx.get("busqueda_sugerida"),
        ctx.get("marca_modelo"),
        ctx.get("codigo_acp"),
    ]
    if not any(str(part or "").strip() for part in parts):
        parts.append(str(ctx.get("descripcion", ""))[:180])
    unique = []
    seen = set()
    for part in parts:
        text = re.sub(r"\s+", " ", str(part or "")).strip()
        key = text.lower()
        if text and key not in seen:
            seen.add(key)
            unique.append(text)
    return " ".join(unique)

def _sourcing_queries(ctx: dict, custom_prompt="", depth="Profunda"):
    base = _sourcing_base_query(ctx)
    brand = str(ctx.get("marca_modelo") or "")
    equiv = "equivalent replacement compatible" if ctx.get("acepta_equivalente") is not False else "exact brand model authorized distributor"
    prompt_terms = str(custom_prompt or "")[:180]
    raw = [
        f"{base} manufacturer distributor stock price datasheet",
        f"{base} {brand} authorized distributor quote stock",
        f"{base} {equiv} global supplier industrial",
        f"{base} regional distributor stockist surplus new old stock low price",
        f"{base} OEM aftermarket exporter wholesale {prompt_terms}",
        f"{base} Alibaba manufacturer factory direct exporter datasheet",
        f"{base} Made in China Global Sources supplier factory wholesale",
    ]
    if str(depth).lower().startswith("prof"):
        raw.extend([
            f"{base} site:.com contact us industrial supply",
            f"{base} \"request quote\" \"in stock\" distributor",
            f"{base} factory direct low price industrial supplier contact",
        ])
    seen = set()
    queries = []
    for query in raw:
        clean = re.sub(r"\s+", " ", query).strip()
        if clean and clean.lower() not in seen:
            seen.add(clean.lower())
            queries.append(clean)
    return queries[:7]

def _score_provider(item: dict, query: str):
    title = str(item.get("title", "") or "")
    content = str(item.get("content", "") or "")
    url = str(item.get("url", "") or "")
    haystack = _source_norm(f"{title} {content} {url}")
    score = 45
    reasons = []
    positive = {
        "supplier": 8,
        "distributor": 8,
        "manufacturer": 7,
        "authorized": 8,
        "stock": 6,
        "price": 6,
        "datasheet": 7,
        "catalog": 5,
        "industrial": 4,
        "quote": 4,
    }
    risk = {"used": 8, "refurbished": 8, "ebay": 7, "blog": 6, "forum": 6}
    for term, weight in positive.items():
        if term in haystack:
            score += weight
            reasons.append(term)
    matched = [token for token in _source_tokens(query) if token in haystack]
    if matched:
        score += min(18, len(set(matched)) * 4)
        reasons.append("match tecnico")
    for term, weight in risk.items():
        if term in haystack:
            score -= weight
    score = max(0, min(100, score))
    risk_label = "Bajo" if score >= 78 else "Medio" if score >= 58 else "Alto"
    price_signal = "Alta" if any(term in haystack for term in ["stock", "surplus", "wholesale", "price"]) else "Media"
    return score, risk_label, price_signal, ", ".join(dict.fromkeys(reasons)) or "Evidencia limitada"

def _collect_tavily_evidence(tavily_key: str, ctx: dict, custom_prompt="", depth="Profunda", target_results=36):
    if not tavily_key:
        return []
    from tavily import TavilyClient

    client = TavilyClient(api_key=tavily_key)
    evidence = []
    per_query = 6 if str(depth).lower().startswith("prof") else 4
    for query in _sourcing_queries(ctx, custom_prompt=custom_prompt, depth=depth):
        if len(evidence) >= target_results:
            break
        result = client.search(
            query=query,
            search_depth="advanced" if str(depth).lower().startswith("prof") else "basic",
            max_results=per_query,
        )
        for item in result.get("results", []) or []:
            evidence.append({
                "source": "Tavily",
                "query": query,
                "title": item.get("title", ""),
                "content": item.get("content", ""),
                "url": item.get("url", ""),
            })
    unique = []
    seen_urls = set()
    for item in evidence:
        url = str(item.get("url", "") or "").strip()
        if not url or url in seen_urls:
            continue
        seen_urls.add(url)
        unique.append(item)
        if len(unique) >= target_results:
            break
    return unique

def _fallback_provider_rows(ctx: dict, evidence: list, target_count=10):
    query = _sourcing_base_query(ctx)
    rows = []
    for item in evidence[:target_count]:
        score, risk_label, price_signal, reason = _score_provider(item, query)
        rows.append({
            "renglon": ctx.get("renglon", ""),
            "proveedor": item.get("title", ""),
            "pais_region": "No confirmado",
            "tipo": "No confirmado",
            "match_tecnico": score,
            "probabilidad_buen_precio": price_signal,
            "riesgo": risk_label,
            "decision": "Recomendado" if score >= 78 else "Validar antes de cotizar",
            "evidencia": reason,
            "que_validar": "Confirmar ficha tecnica, stock, precio, direccion, referencias, forma de pago y terminos Net 30.",
            "url": item.get("url", ""),
        })
    return rows

def _manual_sourcing_plan(ctx: dict, custom_prompt="", depth="Profunda"):
    query = _sourcing_base_query(ctx)
    return {
        "renglon": ctx.get("renglon", ""),
        "codigo_acp": ctx.get("codigo_acp", ""),
        "query_base": query,
        "queries": _sourcing_queries(ctx, custom_prompt=custom_prompt, depth=depth),
        "validar": [
            "Ficha tecnica o catalogo compatible con el renglon.",
            "Contacto corporativo verificable: web, correo, telefono y direccion.",
            "Precio, moneda, stock, lead time, Incoterm y validez de oferta.",
            "Terminos de pago Net 30 o superior si es posible.",
            "Evitar pagos sin trazabilidad, dominios sospechosos o empresas sin historial visible.",
        ],
        "criterio": "Priorizar precio bajo y cumplimiento tecnico. El proveedor debe ser real, trazable y comercialmente seguro.",
    }

def _sourcing_requirement_matrix(ctx: dict):
    requirements = []

    def add_requirement(name, value, mandatory=True):
        clean = re.sub(r"\s+", " ", str(value or "")).strip()
        if clean:
            requirements.append({
                "requisito": name,
                "valor_solicitado": clean[:1800],
                "obligatorio": bool(mandatory),
            })

    description = ctx.get("descripcion") or ctx.get("busqueda_sugerida")
    add_requirement("Producto y especificaciones", description)
    add_requirement("Marca, modelo o numero de parte", ctx.get("marca_modelo"), ctx.get("acepta_equivalente") is False)
    add_requirement("Restriccion detectada", ctx.get("restriccion_detectada"), True)

    if ctx.get("acepta_equivalente") is False:
        add_requirement("Equivalencia", "No se aceptan equivalentes; validar marca y modelo exactos.", True)
    elif ctx.get("acepta_equivalente") is True:
        add_requirement("Equivalencia", "Se permiten alternativas solo si demuestran cumplimiento tecnico igual o superior.", True)

    documents = []
    if ctx.get("requiere_propuesta_tecnica"):
        documents.append("propuesta tecnica")
    if ctx.get("requiere_ficha_tecnica"):
        documents.append("ficha tecnica o catalogo")
    if ctx.get("requiere_carta_fabricante"):
        documents.append("carta del fabricante")
    if documents:
        add_requirement("Documentacion obligatoria", ", ".join(documents), True)

    add_requirement("Evidencia del RFQ", ctx.get("evidencia_tecnica"), True)
    add_requirement("Observaciones", ctx.get("observaciones"), False)
    return requirements[:8]

def _normalize_sourcing_status(value, default="No demostrado"):
    normalized = _source_norm(value)
    if "no cumple" in normalized or "incompatible" in normalized:
        return "No cumple"
    if "confirmado" in normalized or "cumple con evidencia" in normalized:
        return "Confirmado"
    if "compatible" in normalized or "validacion" in normalized or "parcial" in normalized:
        return "Compatible con validacion"
    return default

def _provider_expected_requirement_count(row: dict, contexts: list):
    if not contexts:
        return 0
    covered = row.get("renglones_cubiertos") if isinstance(row.get("renglones_cubiertos"), list) else []
    covered = {str(value).strip() for value in covered if str(value).strip()}
    row_scope = str(row.get("renglon", "") or "").strip()
    if row_scope and _source_norm(row_scope) not in {"todos", "varios"}:
        covered.add(row_scope)
    selected = [ctx for ctx in contexts if not covered or str(ctx.get("renglon", "") or "").strip() in covered]
    return sum(len(_sourcing_requirement_matrix(ctx)) for ctx in selected)

def _normalize_sourcing_provider(row: dict, context_count=1, expected_requirements=0):
    normalized = dict(row or {})
    url = _audit_normalize_url(normalized.get("url", ""))
    normalized["url"] = url

    checks = []
    for check in normalized.get("verificaciones_tecnicas", []) or []:
        if not isinstance(check, dict):
            continue
        requirement = re.sub(r"\s+", " ", str(check.get("requisito", "") or "")).strip()
        if not requirement:
            continue
        checks.append({
            "requisito": requirement[:500],
            "estado": _normalize_sourcing_status(check.get("estado")),
            "evidencia": re.sub(r"\s+", " ", str(check.get("evidencia", "") or "")).strip()[:900],
            "fuente": _audit_normalize_url(check.get("fuente", "")) or url,
        })
        if len(checks) >= 8:
            break
    normalized["verificaciones_tecnicas"] = checks
    normalized["requisitos_revisados"] = len(checks)
    normalized["requisitos_esperados"] = max(0, int(expected_requirements or 0))
    normalized["requisitos_confirmados"] = sum(1 for check in checks if check["estado"] == "Confirmado")

    declared_status = _normalize_sourcing_status(normalized.get("estado_tecnico"))
    check_states = {check["estado"] for check in checks}
    if "No cumple" in check_states:
        technical_status = "No cumple"
    elif not url or not checks:
        technical_status = "No demostrado"
    elif check_states == {"Confirmado"} and (not expected_requirements or len(checks) >= expected_requirements):
        technical_status = "Confirmado"
    elif "Confirmado" in check_states or "Compatible con validacion" in check_states:
        technical_status = "Compatible con validacion"
    else:
        technical_status = declared_status if declared_status != "Confirmado" else "Compatible con validacion"
    normalized["estado_tecnico"] = technical_status

    raw_price = re.sub(r"\s+", " ", str(normalized.get("precio_publicado", "") or "")).strip()
    price_state = _source_norm(normalized.get("estado_precio"))
    if raw_price and url:
        normalized["estado_precio"] = "Precio publicado"
        normalized["precio_publicado"] = raw_price[:160]
    elif "cotizacion" in price_state or "quote" in price_state:
        normalized["estado_precio"] = "Cotizacion requerida"
        normalized["precio_publicado"] = ""
    else:
        normalized["estado_precio"] = "Sin precio verificable"
        normalized["precio_publicado"] = ""

    if not url or not checks:
        evidence_level = "Insuficiente"
    elif technical_status == "Confirmado":
        evidence_level = "Suficiente"
    else:
        evidence_level = "Parcial"
    normalized["nivel_evidencia"] = evidence_level

    risk = str(normalized.get("riesgo", "") or "Medio").strip().title()
    if risk not in {"Bajo", "Medio", "Alto"}:
        risk = "Medio"
    if not url:
        risk = "Alto"
    normalized["riesgo"] = risk

    covered_rows = normalized.get("renglones_cubiertos") if isinstance(normalized.get("renglones_cubiertos"), list) else []
    if normalized.get("renglon") not in (None, "", "Todos", "varios"):
        covered_rows = [*covered_rows, normalized.get("renglon")]
    covered_rows = list(dict.fromkeys(str(value).strip() for value in covered_rows if str(value).strip()))
    normalized["renglones_cubiertos"] = covered_rows

    try:
        coverage = int(float(normalized.get("cobertura_renglones", 0) or 0))
    except (TypeError, ValueError):
        coverage = 0
    coverage = max(coverage, len(covered_rows))
    normalized["cobertura_renglones"] = coverage
    coverage_points = min(15, round((coverage / max(1, context_count)) * 15))
    technical_points = {"Confirmado": 50, "Compatible con validacion": 32, "No demostrado": 12, "No cumple": 0}[technical_status]
    price_points = {"Precio publicado": 20, "Cotizacion requerida": 8, "Sin precio verificable": 0}[normalized["estado_precio"]]
    risk_points = {"Bajo": 15, "Medio": 7, "Alto": 0}[risk]
    normalized["puntaje_ranking"] = max(0, min(100, technical_points + price_points + risk_points + coverage_points))

    if technical_status == "No cumple":
        normalized["decision"] = "Descartar"
    elif technical_status == "Confirmado" and risk == "Bajo":
        normalized["decision"] = "Puede avanzar"
    else:
        normalized["decision"] = "Validar antes de cotizar"
    return normalized

def _ai_rank_providers(gemini_key: str, ctx: dict, evidence: list, custom_prompt="", target_count=10):
    evidence_payload = [
        {
            "idx": idx + 1,
            "source": item.get("source", ""),
            "title": item.get("title", ""),
            "snippet": str(item.get("content", ""))[:700],
            "url": item.get("url", ""),
        }
        for idx, item in enumerate(evidence[:40])
    ]
    prompt = f"""
Actua como Especialista Senior de Sourcing Global Industrial.

Objetivo:
- Encontrar {target_count} proveedores reales para el renglon.
- Prioridad 1: cumplimiento tecnico.
- Prioridad 2: probabilidad de buen precio.
- Alcance global sin restriccion geografica.
- Favorece distribuidores regionales, stockistas industriales, fabricantes pequenos, fabricantes directos, marketplaces B2B y proveedores menos obvios.
- Alibaba, Made-in-China y Global Sources pueden ser utiles si la evidencia muestra proveedor real y producto compatible. No los descartes por ser marketplace; clasifica el riesgo.
- Evita empresas fantasma, paginas sin contacto claro, blogs y resultados que no vendan el producto.
- No inventes precios, stock, certificaciones ni contactos. Usa solo la evidencia entregada.
- Usa "probabilidad_buen_precio" como Oportunidad de ahorro: Alta/Media/Baja.
- Evalua "riesgo" con enfoque comercial: Bajo/Medio/Alto.

Renglon:
{json.dumps(ctx, ensure_ascii=False, indent=2)}

Instruccion personalizada:
{custom_prompt or "Priorizar precio bajo, cumplimiento tecnico y proveedores reales poco saturados."}

Evidencia web:
{json.dumps(evidence_payload, ensure_ascii=False, indent=2)}

Devuelve SOLO JSON valido:
{{
  "resumen_busqueda": "1 frase breve",
  "proveedores": [
    {{
      "renglon": "{ctx.get('renglon', '')}",
      "proveedor": "Nombre de empresa o resultado",
      "pais_region": "Pais/region si se evidencia, si no: No confirmado",
      "tipo": "Fabricante/Distribuidor/Stockista/Marketplace/No confirmado",
      "match_tecnico": 85,
      "probabilidad_buen_precio": "Alta/Media/Baja",
      "riesgo": "Bajo/Medio/Alto",
      "decision": "Recomendado/Validar antes de cotizar/Descartar",
      "evidencia": "Por que puede servir segun la evidencia",
      "que_validar": "Que pedir antes de comprar o cotizar",
      "url": "URL exacta de evidencia"
    }}
  ]
}}
"""
    response = gemini_generate_content(gemini_key, prompt, response_mime_type="application/json")
    raw = str(getattr(response, "text", "") or "").strip().replace("```json", "").replace("```", "").strip()
    data = json.loads(raw)
    providers = data.get("proveedores", []) if isinstance(data, dict) else []
    return data.get("resumen_busqueda", ""), providers[:target_count]

def _ai_find_providers_with_gemini(gemini_key: str, ctx: dict, custom_prompt="", target_count=10, use_google_search=True):
    from google.genai import types

    prompt = f"""
Actua como Especialista Senior de Sourcing Global Industrial para Proyelec International.

Objetivo operacional:
Encontrar {target_count} proveedores que realmente puedan cotizar el renglon, con prioridad estricta:
1. Cumplimiento tecnico con el RFQ.
2. Oportunidad de ahorro/precio agresivo.
3. Empresa real, trazable y comercialmente segura.

Metodo obligatorio antes de listar proveedores:
1. Interpreta que producto pide el renglon: familia tecnica, funcion, codigo ACP, numero de parte, marca/modelo, equivalentes permitidos, cantidad, unidad y documentos requeridos.
2. Define la estrategia de busqueda logica: fabricante directo, distribuidor autorizado, stockista, excedente nuevo, marketplace B2B, proveedor regional o alternativo compatible.
3. Busca globalmente sin restriccion geografica. Alibaba, Made-in-China, Global Sources y proveedores poco obvios pueden servir solo si hay senales de empresa real.
4. Descarta ruido: blogs, foros, paginas sin venta, resultados sin relacion tecnica, empresas sin contacto claro o dominios sospechosos.
5. No inventes precios, stock, certificaciones, emails ni contactos. Si un dato no esta confirmado, escribe "No confirmado".
6. Si la marca/modelo parece obligatoria, prioriza exacto/autorizado. Si acepta equivalentes, incluye alternativas tecnicamente compatibles pero marca las validaciones pendientes.
7. No uses un porcentaje general como sustituto de evidencia. Comprueba cada requisito con una URL concreta.
8. Usa "Confirmado" solo cuando la fuente demuestre el requisito. La ausencia del dato es "No demostrado".
9. Solo usa "Precio publicado" si la fuente muestra precio concreto. No deduzcas que un proveedor es barato.

Renglon:
{json.dumps(ctx, ensure_ascii=False, indent=2)}

Matriz de requisitos que debes comprobar:
{json.dumps(_sourcing_requirement_matrix(ctx), ensure_ascii=False, indent=2)}

Instruccion personalizada del usuario:
{custom_prompt or "Priorizar proveedores reales, bajo costo, ficha tecnica compatible y bajo riesgo."}

Devuelve SOLO JSON valido:
{{
  "resumen_busqueda": "1 frase breve y util sobre la estrategia y el resultado",
  "estrategia_busqueda": ["termino o enfoque usado", "otro enfoque usado"],
  "proveedores": [
    {{
      "renglon": "{ctx.get('renglon', '')}",
      "proveedor": "Nombre del proveedor",
      "pais_region": "Pais/region si esta confirmado, si no: No confirmado",
      "tipo": "Fabricante/Distribuidor/Stockista/Marketplace/No confirmado",
      "estado_tecnico": "Confirmado/Compatible con validacion/No demostrado/No cumple",
      "estado_precio": "Precio publicado/Cotizacion requerida/Sin precio verificable",
      "precio_publicado": "Precio, moneda y unidad exactamente como aparecen en la fuente; vacio si no existe",
      "moneda": "Moneda confirmada o No confirmado",
      "disponibilidad": "Stock confirmado/Pendiente de confirmar/No confirmado",
      "lead_time": "Plazo confirmado o No confirmado",
      "verificaciones_tecnicas": [
        {{
          "requisito": "Requisito concreto de la matriz",
          "estado": "Confirmado/Compatible con validacion/No demostrado/No cumple",
          "evidencia": "Dato exacto observado, sin inventar",
          "fuente": "URL exacta que respalda este requisito"
        }}
      ],
      "riesgo": "Bajo/Medio/Alto",
      "decision": "Puede avanzar/Validar antes de cotizar/Descartar",
      "evidencia": "Por que puede servir y que evidencia observada lo respalda",
      "que_validar": "Validaciones concretas antes de cotizar: ficha tecnica, precio, stock, lead time, Incoterm, Net 30, empresa real, direccion y trazabilidad",
      "url": "URL si esta disponible, si no vacio"
    }}
  ]
}}
"""
    client = get_gemini_client(gemini_key)
    tools = [types.Tool(googleSearch=types.GoogleSearch())] if use_google_search else None
    config = types.GenerateContentConfig(
        responseMimeType="application/json",
        tools=tools,
    )
    response, used_model = gemini_generate_with_fallback(client, prompt, response_mime_type="application/json") if not use_google_search else (None, "")
    if use_google_search:
        last_error = None
        for idx, model in enumerate(gemini_model_candidates()):
            try:
                response = client.models.generate_content(model=model, contents=prompt, config=config)
                used_model = model
                break
            except Exception as exc:
                last_error = exc
                if idx == len(gemini_model_candidates()) - 1:
                    raise
                if is_retryable_gemini_error(exc):
                    time.sleep(1 + idx)
                    continue
                raise
        if response is None:
            raise last_error or RuntimeError("No se pudo generar sourcing con Gemini.")

    raw = str(getattr(response, "text", "") or "").strip().replace("```json", "").replace("```", "").strip()
    data = json.loads(raw)
    providers = data.get("proveedores", []) if isinstance(data, dict) else []
    urls = [row.get("url") for row in providers if isinstance(row, dict) and str(row.get("url", "")).strip()]
    return data.get("resumen_busqueda", ""), providers[:target_count], len(urls), used_model, getattr(response, "usage_metadata", None)

def _ai_find_integral_providers_with_gemini(gemini_key: str, contexts: list, custom_prompt="", target_count=10, use_google_search=True):
    from google.genai import types

    prompt = f"""
Actua como Especialista Senior de Sourcing Global Industrial para Proyelec International.

Objetivo operacional:
Encontrar {target_count} proveedores reales que puedan cotizar TODOS los renglones del RFQ o la mayor cantidad posible en una sola solicitud.

Prioridad estricta:
1. Cobertura de renglones: primero proveedores integrales que puedan cubrir todos los renglones; luego proveedores que cubran varios; por ultimo especialistas por un solo renglon.
2. Cumplimiento tecnico con cada renglon cubierto.
3. Oportunidad de ahorro/precio agresivo.
4. Empresa real, trazable y comercialmente segura.

Metodo obligatorio:
1. Agrupa los renglones por familia tecnica, marca/modelo, codigo ACP, equivalencias permitidas y requisitos documentales.
2. Busca proveedores globales con catalogo amplio, fabricantes directos, distribuidores industriales, stockistas y marketplaces B2B confiables capaces de cotizar varios renglones.
3. Si no hay proveedor integral creible, devuelve una combinacion de proveedores que maximice cobertura con el menor numero de empresas.
4. No inventes cobertura, precios, stock, certificaciones, emails ni contactos. Si algo no esta confirmado, escribe "No confirmado" o "Validar".
5. Alibaba, Made-in-China y Global Sources pueden servir si hay senales de proveedor real; clasifica el riesgo.
6. Marca claramente que renglones cubre cada proveedor y que debe validarse antes de cotizar.
7. No uses un porcentaje general como sustituto de evidencia. Comprueba requisitos concretos por cada renglon cubierto.
8. Usa "Confirmado" solo cuando una URL demuestre el requisito. La ausencia del dato es "No demostrado".
9. Solo usa "Precio publicado" si una fuente muestra precio concreto. No deduzcas que un proveedor es barato.

Renglones del RFQ:
{json.dumps(contexts, ensure_ascii=False, indent=2)}

Matrices de requisitos por renglon:
{json.dumps([{"renglon": ctx.get("renglon", ""), "requisitos": _sourcing_requirement_matrix(ctx)} for ctx in contexts], ensure_ascii=False, indent=2)}

Instruccion personalizada del usuario:
{custom_prompt or "Priorizar proveedores integrales, precio bajo, cumplimiento tecnico y bajo riesgo comercial."}

Devuelve SOLO JSON valido:
{{
  "resumen_busqueda": "1 frase breve sobre si existen proveedores integrales o si conviene dividir por familias",
  "estrategia_busqueda": ["enfoque usado", "otro enfoque usado"],
  "proveedores": [
    {{
      "renglon": "Todos / varios / renglon especifico",
      "renglones_cubiertos": ["1", "2"],
      "cobertura_renglones": 2,
      "cobertura_detalle": "Explica que renglones puede cotizar y cuales quedan pendientes o por validar",
      "proveedor": "Nombre del proveedor",
      "pais_region": "Pais/region si esta confirmado, si no: No confirmado",
      "tipo": "Fabricante/Distribuidor/Stockista/Marketplace/No confirmado",
      "estado_tecnico": "Confirmado/Compatible con validacion/No demostrado/No cumple",
      "estado_precio": "Precio publicado/Cotizacion requerida/Sin precio verificable",
      "precio_publicado": "Precio, moneda y unidad exactamente como aparecen en la fuente; vacio si no existe",
      "moneda": "Moneda confirmada o No confirmado",
      "disponibilidad": "Stock confirmado/Pendiente de confirmar/No confirmado",
      "lead_time": "Plazo confirmado o No confirmado",
      "verificaciones_tecnicas": [
        {{
          "requisito": "Renglon y requisito concreto comprobado",
          "estado": "Confirmado/Compatible con validacion/No demostrado/No cumple",
          "evidencia": "Dato exacto observado, sin inventar",
          "fuente": "URL exacta que respalda este requisito"
        }}
      ],
      "riesgo": "Bajo/Medio/Alto",
      "decision": "Puede avanzar/Validar antes de cotizar/Descartar",
      "evidencia": "Por que puede servir y que evidencia observada lo respalda",
      "que_validar": "Validaciones concretas: ficha tecnica por renglon, precio, stock, lead time, Incoterm, Net 30, empresa real, direccion y trazabilidad",
      "url": "URL si esta disponible, si no vacio"
    }}
  ]
}}
"""
    client = get_gemini_client(gemini_key)
    tools = [types.Tool(googleSearch=types.GoogleSearch())] if use_google_search else None
    config = types.GenerateContentConfig(
        responseMimeType="application/json",
        tools=tools,
    )
    response, used_model = gemini_generate_with_fallback(client, prompt, response_mime_type="application/json") if not use_google_search else (None, "")
    if use_google_search:
        last_error = None
        for idx, model in enumerate(gemini_model_candidates()):
            try:
                response = client.models.generate_content(model=model, contents=prompt, config=config)
                used_model = model
                break
            except Exception as exc:
                last_error = exc
                if idx == len(gemini_model_candidates()) - 1:
                    raise
                if is_retryable_gemini_error(exc):
                    time.sleep(1 + idx)
                    continue
                raise
        if response is None:
            raise last_error or RuntimeError("No se pudo generar sourcing integral con Gemini.")

    raw = str(getattr(response, "text", "") or "").strip().replace("```json", "").replace("```", "").strip()
    data = json.loads(raw)
    providers = data.get("proveedores", []) if isinstance(data, dict) else []
    urls = [row.get("url") for row in providers if isinstance(row, dict) and str(row.get("url", "")).strip()]
    return data.get("resumen_busqueda", ""), providers[:target_count], len(urls), used_model, getattr(response, "usage_metadata", None)

def _audit_normalize_url(value: str):
    text = str(value or "").strip()
    if not text:
        return ""
    if not re.match(r"^https://", text, flags=re.IGNORECASE):
        text = f"https://{text}"
    parsed = urlparse(text)
    hostname = (parsed.hostname or "").strip()
    if not parsed.netloc or "." not in hostname or re.search(r"\s", hostname):
        return ""
    return text

def _audit_domain_from_url(url: str):
    parsed = urlparse(url or "")
    domain = (parsed.netloc or "").split("@")[-1].split(":")[0].strip().lower()
    if domain.startswith("www."):
        domain = domain[4:]
    return domain

def _audit_fetch_json(url: str, timeout=8):
    req = Request(url, headers={"User-Agent": "ProcuraAI-Auditor/1.0"})
    with urlopen(req, timeout=timeout) as response:
        return json.loads(response.read(1_500_000).decode("utf-8", errors="replace"))

def _audit_parse_datetime(value):
    if not value:
        return None
    text = str(value).replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(text).replace(tzinfo=None)
    except Exception:
        for fmt in ["%Y-%m-%dT%H:%M:%S", "%Y-%m-%d"]:
            try:
                return datetime.strptime(str(value)[:19], fmt)
            except Exception:
                continue
    return None

def _audit_rdap_lookup(domain: str):
    result = {
        "available": False,
        "domain": domain,
        "source": "",
        "registrar": "No confirmado",
        "created_at": None,
        "expires_at": None,
        "domain_age_days": None,
        "expires_in_days": None,
        "nameservers": [],
        "status": [],
        "error": "",
    }
    if not domain or "." not in domain:
        result["error"] = "Dominio no disponible para RDAP."
        return result
    try:
        tld = domain.rsplit(".", 1)[-1].lower()
        bootstrap = _audit_fetch_json("https://data.iana.org/rdap/dns.json")
        service_url = ""
        for service in bootstrap.get("services", []) or []:
            tlds, urls = service
            if tld in [str(item).lower() for item in tlds] and urls:
                service_url = str(urls[0]).rstrip("/")
                break
        rdap_url = f"{service_url}/domain/{domain}" if service_url else f"https://rdap.org/domain/{domain}"
        data = _audit_fetch_json(rdap_url)
        result["available"] = True
        result["source"] = rdap_url
        result["status"] = data.get("status", []) if isinstance(data.get("status"), list) else []
        result["nameservers"] = [
            ns.get("ldhName") or ns.get("unicodeName")
            for ns in data.get("nameservers", []) or []
            if isinstance(ns, dict) and (ns.get("ldhName") or ns.get("unicodeName"))
        ][:6]
        for event in data.get("events", []) or []:
            action = str(event.get("eventAction", "")).lower()
            date = event.get("eventDate")
            if action in ["registration", "registered", "domain registration"]:
                result["created_at"] = date
            if action in ["expiration", "expiry", "expires"]:
                result["expires_at"] = date
        for entity in data.get("entities", []) or []:
            roles = [str(role).lower() for role in entity.get("roles", [])] if isinstance(entity, dict) else []
            if "registrar" not in roles:
                continue
            vcard = entity.get("vcardArray", [])
            if isinstance(vcard, list) and len(vcard) > 1:
                for row in vcard[1]:
                    if isinstance(row, list) and row and row[0] == "fn" and len(row) >= 4:
                        result["registrar"] = row[3] or "No confirmado"
                        break
            if result["registrar"] != "No confirmado":
                break
        now = datetime.utcnow()
        created = _audit_parse_datetime(result["created_at"])
        expires = _audit_parse_datetime(result["expires_at"])
        if created:
            result["domain_age_days"] = max(0, (now - created).days)
        if expires:
            result["expires_in_days"] = (expires - now).days
        return result
    except Exception as exc:
        result["error"] = str(exc)[:300]
        return result

def _audit_ssl_info(domain: str):
    result = {
        "available": False,
        "valid": False,
        "issuer": "No confirmado",
        "subject": "No confirmado",
        "expires_at": None,
        "expires_in_days": None,
        "error": "",
    }
    if not domain:
        result["error"] = "Dominio no disponible para SSL."
        return result
    try:
        context = ssl.create_default_context()
        with socket.create_connection((domain, 443), timeout=6) as sock:
            with context.wrap_socket(sock, server_hostname=domain) as ssock:
                cert = ssock.getpeercert()
        result["available"] = True
        result["valid"] = True
        issuer_parts = cert.get("issuer", [])
        subject_parts = cert.get("subject", [])
        issuer = []
        subject = []
        for part in issuer_parts:
            for key, value in part:
                if key in ["organizationName", "commonName"]:
                    issuer.append(value)
        for part in subject_parts:
            for key, value in part:
                if key in ["organizationName", "commonName"]:
                    subject.append(value)
        result["issuer"] = ", ".join(dict.fromkeys(issuer)) or "No confirmado"
        result["subject"] = ", ".join(dict.fromkeys(subject)) or "No confirmado"
        not_after = cert.get("notAfter")
        if not_after:
            expires = datetime.strptime(not_after, "%b %d %H:%M:%S %Y %Z")
            result["expires_at"] = expires.isoformat()
            result["expires_in_days"] = (expires - datetime.utcnow()).days
        return result
    except Exception as exc:
        result["error"] = str(exc)[:300]
        return result

def _audit_website_signals(url: str):
    result = {
        "available": False,
        "url": url,
        "final_url": "",
        "status_code": None,
        "https": bool(str(url or "").lower().startswith("https://")),
        "title": "",
        "has_contact_page": False,
        "has_about_page": False,
        "has_privacy_or_terms": False,
        "emails": [],
        "free_email_detected": False,
        "phones_detected": 0,
        "error": "",
    }
    if not url:
        result["error"] = "URL no indicada."
        return result
    try:
        req = Request(url, headers={"User-Agent": "ProcuraAI-Auditor/1.0"})
        try:
            with urlopen(req, timeout=10) as response:
                result["status_code"] = getattr(response, "status", None)
                result["final_url"] = response.geturl()
                raw = response.read(350_000).decode("utf-8", errors="replace")
        except HTTPError as http_exc:
            result["status_code"] = http_exc.code
            result["final_url"] = http_exc.geturl()
            if http_exc.code in [401, 403, 405, 429]:
                result["available"] = True
                result["https"] = str(result["final_url"] or url).lower().startswith("https://")
                result["error"] = f"Web existe, pero bloqueo lectura automatica HTTP {http_exc.code}."
                return result
            raw = http_exc.read(120_000).decode("utf-8", errors="replace")
        result["available"] = True
        result["https"] = str(result["final_url"] or url).lower().startswith("https://")
        soup = BeautifulSoup(raw, "html.parser")
        title = soup.find("title")
        result["title"] = title.get_text(" ", strip=True)[:180] if title else ""
        text = soup.get_text(" ", strip=True).lower()
        hrefs = " ".join(str(a.get("href", "")) for a in soup.find_all("a")[:250]).lower()
        combined = f"{text} {hrefs}"
        result["has_contact_page"] = any(term in combined for term in ["contact", "contacto", "about/contact", "mailto:"])
        result["has_about_page"] = any(term in combined for term in ["about us", "about-us", "quienes somos", "sobre nosotros", "company profile"])
        result["has_privacy_or_terms"] = any(term in combined for term in ["privacy", "terms", "policy", "terminos", "privacidad"])
        emails = re.findall(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", raw, flags=re.IGNORECASE)
        unique_emails = list(dict.fromkeys(email.lower() for email in emails))[:8]
        result["emails"] = unique_emails
        result["free_email_detected"] = any(re.search(r"@(gmail|yahoo|hotmail|outlook|qq|163|126)\.", email) for email in unique_emails)
        result["phones_detected"] = len(re.findall(r"(?:\+\d{1,3}[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-]?){2,4}\d{3,4}", raw))
        return result
    except Exception as exc:
        result["error"] = str(exc)[:300]
        return result

def _audit_score_signals(signals: dict):
    score = 50
    positives = []
    alerts = []
    url = signals.get("normalized_url", "")
    domain = signals.get("domain", "")
    rdap = signals.get("rdap", {}) or {}
    ssl_info = signals.get("ssl", {}) or {}
    web = signals.get("website", {}) or {}

    if not url or not domain:
        score -= 25
        alerts.append("No se proporciono dominio/web verificable.")
    if rdap.get("available"):
        score += 8
        positives.append("RDAP/WHOIS disponible para el dominio.")
        age = rdap.get("domain_age_days")
        if isinstance(age, int):
            if age < 90:
                score -= 22
                alerts.append("Dominio creado hace menos de 90 dias.")
            elif age < 365:
                score -= 10
                alerts.append("Dominio creado hace menos de 1 ano.")
            elif age > 730:
                score += 10
                positives.append("Dominio con mas de 2 anos de antiguedad.")
        expires = rdap.get("expires_in_days")
        if isinstance(expires, int) and expires < 45:
            score -= 8
            alerts.append("Dominio expira pronto; validar continuidad del proveedor.")
        if rdap.get("registrar") and rdap.get("registrar") != "No confirmado":
            positives.append(f"Registrador identificado: {rdap.get('registrar')}.")
    elif domain:
        score -= 10
        alerts.append("No se pudo obtener RDAP/WHOIS del dominio.")

    if ssl_info.get("valid"):
        score += 8
        positives.append("Certificado SSL valido en el dominio.")
        expires_ssl = ssl_info.get("expires_in_days")
        if isinstance(expires_ssl, int) and expires_ssl < 30:
            score -= 8
            alerts.append("Certificado SSL expira en menos de 30 dias.")
    elif domain:
        score -= 14
        alerts.append("No se pudo validar SSL/TLS del dominio.")

    if web.get("available"):
        score += 8
        positives.append("Web accesible durante la auditoria.")
        if web.get("https"):
            score += 4
            positives.append("La web carga por HTTPS.")
        else:
            score -= 10
            alerts.append("La web no carga por HTTPS.")
        if web.get("has_contact_page"):
            score += 6
            positives.append("Se detecto pagina o datos de contacto.")
        else:
            score -= 8
            alerts.append("No se detecto pagina/contacto claro en la web.")
        if web.get("has_about_page"):
            score += 4
            positives.append("Se detecto informacion corporativa tipo About/Company.")
        if web.get("has_privacy_or_terms"):
            score += 3
        if web.get("emails"):
            score += 4
            positives.append("Se detectaron correos publicados en la web.")
        else:
            score -= 5
            alerts.append("No se detectaron correos publicados en la web.")
        if web.get("free_email_detected"):
            score -= 12
            alerts.append("Se detecto correo gratuito; pedir correo corporativo y datos fiscales.")
        if int(web.get("phones_detected") or 0) > 0:
            score += 3
            positives.append("Se detectaron posibles telefonos en la web.")
    elif url:
        score -= 15
        alerts.append("La web no fue accesible durante la auditoria.")

    score = max(0, min(100, score))
    risk = "Bajo" if score >= 80 else "Medio" if score >= 60 else "Alto"
    decision = "Avanzar" if score >= 82 else "Avanzar con cautela" if score >= 65 else "Pedir validacion" if score >= 45 else "Descartar"
    return {
        "score": score,
        "riesgo_tecnico": risk,
        "decision_tecnica": decision,
        "positivos": list(dict.fromkeys(positives)),
        "alertas": list(dict.fromkeys(alerts)),
    }

def _audit_collect_technical_signals(company_name: str, website: str):
    normalized_url = _audit_normalize_url(website)
    domain = _audit_domain_from_url(normalized_url)
    if domain:
        with ThreadPoolExecutor(max_workers=3) as executor:
            rdap_future = executor.submit(_audit_rdap_lookup, domain)
            ssl_future = executor.submit(_audit_ssl_info, domain)
            website_future = executor.submit(_audit_website_signals, normalized_url)
            rdap_result = rdap_future.result()
            ssl_result = ssl_future.result()
            website_result = website_future.result()
    else:
        rdap_result = {"available": False, "error": "Sin dominio."}
        ssl_result = {"available": False, "valid": False, "error": "Sin dominio."}
        website_result = {"available": False, "error": "Sin URL."}
    signals = {
        "company_name": company_name,
        "normalized_url": normalized_url,
        "domain": domain,
        "rdap": rdap_result,
        "ssl": ssl_result,
        "website": website_result,
    }
    signals["scorecard"] = _audit_score_signals(signals)
    return signals

def _audit_grounding_sources(response):
    sources = []
    candidates = getattr(response, "candidates", None) or []
    for candidate in candidates:
        metadata = getattr(candidate, "grounding_metadata", None)
        chunks = getattr(metadata, "grounding_chunks", None) if metadata else None
        for chunk in chunks or []:
            web = getattr(chunk, "web", None)
            url = str(getattr(web, "uri", "") or "").strip() if web else ""
            title = str(getattr(web, "title", "") or "").strip() if web else ""
            if url.startswith(("http://", "https://")):
                sources.append({"titulo": title or "Fuente localizada por Google Search", "url": url})
    unique = []
    seen = set()
    for source in sources:
        key = source.get("url", "").lower()
        if key and key not in seen:
            seen.add(key)
            unique.append(source)
    return unique[:30]

def _audit_evidence_url(value):
    url = str(value or "").strip()
    return url if url.startswith(("http://", "https://")) else ""

def _audit_source_host(value):
    try:
        return (urlparse(_audit_evidence_url(value)).hostname or "").lower().strip(".")
    except Exception:
        return ""

def _audit_is_official_source(value):
    host = _audit_source_host(value)
    if not host:
        return False
    return (
        host.endswith((".gov", ".gov.uk", ".gov.cn", ".gob.pa", ".gob.mx", ".gob.es", ".europa.eu"))
        or host in {
            "gov.uk",
            "europa.eu",
            "gleif.org",
            "www.gleif.org",
            "company-information.service.gov.uk",
            "developer.company-information.service.gov.uk",
            "sec.gov",
            "www.sec.gov",
            "ofac.treasury.gov",
            "sanctionssearch.ofac.treas.gov",
        }
    )

def _audit_is_sanctions_source(value):
    url = _audit_evidence_url(value).lower()
    host = _audit_source_host(url)
    if host in {"ofac.treasury.gov", "sanctionssearch.ofac.treas.gov"}:
        return True
    return _audit_is_official_source(url) and any(term in url for term in ["sanction", "sancion", "restrictive-measures"])

def _audit_normalize_check(value, default_status="No verificado"):
    section = value if isinstance(value, dict) else {}
    return {
        "estado": str(section.get("estado") or default_status).strip(),
        "detalle": str(section.get("detalle") or "No confirmado con la evidencia disponible.").strip(),
        "nombre_legal": str(section.get("nombre_legal") or "").strip(),
        "numero_registro": str(section.get("numero_registro") or "").strip(),
        "registro_consultado": str(section.get("registro_consultado") or "").strip(),
        "fuente_url": _audit_evidence_url(section.get("fuente_url")),
        "coincidencias": [str(item).strip() for item in section.get("coincidencias", []) if str(item).strip()] if isinstance(section.get("coincidencias"), list) else [],
        "inconsistencias": [str(item).strip() for item in section.get("inconsistencias", []) if str(item).strip()] if isinstance(section.get("inconsistencias"), list) else [],
        "hallazgos": [str(item).strip() for item in section.get("hallazgos", []) if str(item).strip()] if isinstance(section.get("hallazgos"), list) else [],
    }

def _audit_normalize_ai_result(result: dict, grounded: bool, grounding_sources=None):
    result = result if isinstance(result, dict) else {}
    checked_at = datetime.utcnow().replace(microsecond=0).isoformat() + "Z"
    result["fecha_consulta"] = checked_at
    result["alcance"] = (
        "Preauditoria operativa basada en fuentes publicas. No certifica legalidad, solvencia ni ausencia absoluta de fraude."
    )
    result["identidad_legal"] = _audit_normalize_check(result.get("identidad_legal"))
    result["sanciones"] = _audit_normalize_check(result.get("sanciones"))
    result["reputacion_adversa"] = _audit_normalize_check(result.get("reputacion_adversa"))
    result["coherencia_datos"] = _audit_normalize_check(result.get("coherencia_datos"))

    evidence = []
    for item in result.get("evidencia", []) if isinstance(result.get("evidencia"), list) else []:
        if not isinstance(item, dict):
            continue
        source_url = _audit_evidence_url(item.get("url"))
        evidence.append({
            "titulo": str(item.get("titulo") or "Evidencia consultada").strip(),
            "detalle": str(item.get("detalle") or "").strip(),
            "url": source_url,
            "categoria": str(item.get("categoria") or "Investigacion web").strip(),
            "nivel_fuente": str(item.get("nivel_fuente") or "Fuente publica").strip(),
            "fecha_consulta": str(item.get("fecha_consulta") or checked_at).strip(),
            "verificado": bool(item.get("verificado", False)) and _audit_is_official_source(source_url),
        })

    existing_urls = {item.get("url", "").lower() for item in evidence if item.get("url")}
    for source in grounding_sources or []:
        url = _audit_evidence_url(source.get("url"))
        if not url or url.lower() in existing_urls:
            continue
        existing_urls.add(url.lower())
        evidence.append({
            "titulo": str(source.get("titulo") or "Fuente localizada por Google Search"),
            "detalle": "Fuente utilizada durante la investigacion web; abre el enlace para revisar el contexto completo.",
            "url": url,
            "categoria": "Busqueda web",
            "nivel_fuente": "Fuente localizada por Google Search",
            "fecha_consulta": checked_at,
            "verificado": False,
        })

    for key, category in [
        ("identidad_legal", "Registro empresarial"),
        ("sanciones", "Sanciones"),
        ("reputacion_adversa", "Reputacion y asuntos legales"),
    ]:
        section = result[key]
        url = section.get("fuente_url", "")
        if url and url.lower() not in existing_urls:
            existing_urls.add(url.lower())
            evidence.append({
                "titulo": section.get("registro_consultado") or category,
                "detalle": section.get("detalle", ""),
                "url": url,
                "categoria": category,
                "nivel_fuente": "Fuente declarada por la investigacion",
                "fecha_consulta": checked_at,
                "verificado": _audit_is_official_source(url),
            })

    result["evidencia"] = evidence[:40]
    if not grounded:
        for key in ["identidad_legal", "sanciones", "reputacion_adversa"]:
            result[key]["estado"] = "No verificado"
            result[key]["detalle"] = "La busqueda web con fuentes no estuvo disponible; requiere validacion manual."
        result["confianza"] = "Baja"

    identity = result["identidad_legal"]
    identity_status = identity.get("estado", "").lower()
    if "verificad" in identity_status and "no verific" not in identity_status and not _audit_is_official_source(identity.get("fuente_url")):
        identity["estado"] = "Parcial"
        identity["detalle"] = f"{identity.get('detalle', '')} Falta una fuente registral oficial enlazada."

    sanctions = result["sanciones"]
    sanctions_status = sanctions.get("estado", "").lower()
    sanctions_evidence = any(_audit_is_sanctions_source(item.get("url")) for item in evidence)
    if ("sin coincid" in sanctions_status or "sin hallazgo" in sanctions_status) and not sanctions_evidence:
        sanctions["estado"] = "No verificado"
        sanctions["detalle"] = "No hay una fuente de sanciones enlazada que permita sostener una conclusion negativa."

    written = str(result.get("analisis_escrito") or "").strip()
    if not written:
        written = str(result.get("resumen") or "La evidencia disponible requiere revision antes de operar con el proveedor.").strip()
    result["analisis_escrito"] = written
    return result

def _audit_add_technical_evidence(result: dict, technical_signals: dict):
    evidence = list(result.get("evidencia", []) or [])
    existing_urls = {str(item.get("url", "")).lower() for item in evidence if isinstance(item, dict) and item.get("url")}
    checked_at = result.get("fecha_consulta") or datetime.utcnow().replace(microsecond=0).isoformat() + "Z"
    rdap = technical_signals.get("rdap", {}) or {}
    website = technical_signals.get("website", {}) or {}
    ssl_info = technical_signals.get("ssl", {}) or {}

    if rdap.get("available") and rdap.get("source") and str(rdap.get("source")).lower() not in existing_urls:
        evidence.append({
            "titulo": "Registro tecnico del dominio (RDAP)",
            "detalle": f"Dominio consultado. Registrador: {rdap.get('registrar') or 'No confirmado'}.",
            "url": rdap.get("source"),
            "categoria": "Dominio",
            "nivel_fuente": "Registro tecnico autoritativo",
            "fecha_consulta": checked_at,
            "verificado": True,
        })
    if website.get("available"):
        website_url = _audit_evidence_url(website.get("final_url") or technical_signals.get("normalized_url"))
        if website_url and website_url.lower() not in existing_urls:
            evidence.append({
                "titulo": "Sitio web corporativo observado",
                "detalle": f"Sitio accesible durante la auditoria. HTTPS: {'Si' if website.get('https') else 'No'}.",
                "url": website_url,
                "categoria": "Identidad digital",
                "nivel_fuente": "Fuente primaria de la empresa",
                "fecha_consulta": checked_at,
                "verificado": True,
            })
    if ssl_info.get("valid"):
        evidence.append({
            "titulo": "Certificado SSL/TLS validado",
            "detalle": f"Emisor: {ssl_info.get('issuer') or 'No confirmado'}. La validacion tecnica no acredita identidad legal.",
            "url": "",
            "categoria": "Seguridad web",
            "nivel_fuente": "Comprobacion tecnica directa",
            "fecha_consulta": checked_at,
            "verificado": True,
        })
    result["evidencia"] = evidence[:40]
    return result

def _audit_finalize_assessment(result: dict, technical_signals: dict, grounded=True):
    scorecard = technical_signals.get("scorecard", {}) or {}
    rdap = technical_signals.get("rdap", {}) or {}
    website = technical_signals.get("website", {}) or {}
    domain = str(technical_signals.get("domain", "") or "").strip()

    try:
        ai_score = max(0, min(100, int(float(result.get("score_final", 50)))))
    except (TypeError, ValueError):
        ai_score = 50
    try:
        technical_score = max(0, min(100, int(float(scorecard.get("score", 50)))))
    except (TypeError, ValueError):
        technical_score = 50

    final_score = round((technical_score * 0.65) + (ai_score * 0.35)) if domain else min(ai_score, 55)
    safeguards = []
    domain_age = rdap.get("domain_age_days")
    if isinstance(domain_age, int) and domain_age < 90:
        final_score = min(final_score, 39)
        safeguards.append("Dominio creado hace menos de 90 dias.")
    elif isinstance(domain_age, int) and domain_age < 365:
        final_score = min(final_score, 59)
        safeguards.append("Dominio con menos de un ano de antiguedad.")
    if website.get("free_email_detected"):
        final_score = min(final_score, 59)
        safeguards.append("Se detecto correo gratuito en la web.")
    if domain and not rdap.get("available") and not website.get("available"):
        final_score = min(final_score, 44)
        safeguards.append("No fue posible validar registro de dominio ni acceso web.")
    if not domain:
        safeguards.append("No hay dominio corporativo confirmado.")

    model_risk = str(result.get("riesgo", "") or "").strip().lower()
    model_decision = str(result.get("decision", "") or "").strip().lower()
    if "alto" in model_risk:
        final_score = min(final_score, 49)
    if "descartar" in model_decision:
        final_score = min(final_score, 39)

    identity_status = str((result.get("identidad_legal") or {}).get("estado", "")).lower()
    sanctions_status = str((result.get("sanciones") or {}).get("estado", "")).lower()
    adverse_status = str((result.get("reputacion_adversa") or {}).get("estado", "")).lower()
    if not grounded:
        final_score = min(final_score, 55)
        safeguards.append("La investigacion no tuvo busqueda web con fuentes; confianza limitada.")
    if "no verific" in identity_status:
        final_score = min(final_score, 59)
        safeguards.append("Identidad legal no verificada en un registro oficial.")
    if "posible coincid" in sanctions_status:
        final_score = min(final_score, 29)
        safeguards.append("Posible coincidencia en sanciones; detener y confirmar identidad manualmente.")
    if "coincidencia confirm" in sanctions_status:
        final_score = min(final_score, 10)
        safeguards.append("La investigacion reporta una coincidencia de sanciones que requiere escalamiento inmediato.")
    if "oficial" in adverse_status or "confirmad" in adverse_status:
        final_score = min(final_score, 39)
        safeguards.append("Se reportaron hallazgos adversos oficiales o confirmados.")

    risk = "Bajo" if final_score >= 75 else "Medio" if final_score >= 50 else "Alto"
    decision = "Avanzar" if final_score >= 82 else "Avanzar con cautela" if final_score >= 65 else "Pedir validacion" if final_score >= 30 else "Descartar"
    result["score_ia"] = ai_score
    result["score_tecnico"] = technical_score
    result["score_final"] = final_score
    result["riesgo"] = risk
    result["decision"] = decision
    result["criterio_puntaje"] = "65% evidencia tecnica y 35% investigacion IA" if domain else "Puntaje limitado por falta de dominio verificable"
    result["reglas_seguridad_aplicadas"] = safeguards
    confidence = str(result.get("confianza") or "Media").strip().title()
    if not grounded:
        confidence = "Baja"
    elif "no verific" in identity_status and confidence == "Alta":
        confidence = "Media"
    result["confianza"] = confidence if confidence in {"Alta", "Media", "Baja"} else "Media"
    return result

def _audit_company_with_gemini(gemini_key: str, payload: dict, use_google_search=True):
    from google.genai import types

    prompt = f"""
Actua como Auditor Senior de Riesgo Comercial para compras internacionales B2B.

Objetivo:
- Evaluar si una empresa/proveedor parece real, trazable y razonablemente seguro para solicitar cotizacion o comprar.
- Priorizar prevencion de fraude, empresas fantasma, datos inconsistentes y riesgo operativo.
- No inventes datos. Si no puedes confirmar algo, escribe "No confirmado".
- Si usas busqueda web, separa lo observado de lo pendiente por validar.
- Esto NO es aprobacion legal/financiera final; es una preauditoria operativa para procura.
- Las senales tecnicas automaticas tienen prioridad como evidencia: RDAP/WHOIS, SSL/TLS, HTTPS, accesibilidad web, contacto corporativo y edad del dominio.
- Si hay contradiccion entre una impresion general positiva y una senal tecnica fuerte de riesgo, conserva el riesgo y explica la validacion pendiente.
- Nunca escribas que una empresa es "totalmente segura", "100% legal" o que "no tiene estafas". Usa formulaciones limitadas a las fuentes y fecha consultadas.

Investigacion obligatoria:
1. Identidad legal: busca la razon social exacta en un registro mercantil, fiscal, regulatorio o identificador LEI oficial del pais indicado. Distingue empresa registrada de marca comercial.
2. Sanciones: busca el nombre legal y variantes en fuentes oficiales, priorizando OFAC y listas gubernamentales aplicables. Una coincidencia por nombre es POTENCIAL hasta confirmar pais, direccion y numero de registro.
3. Reputacion adversa: busca fraude, estafa, scam, demanda, sancion regulatoria, quiebra, incumplimiento y alertas oficiales. Separa fuentes oficiales/noticias confiables de quejas o foros no confirmados.
4. Coherencia: compara nombre, pais, direccion, telefono, correo, dominio, numero registral y actividad comercial declarada.
5. Capacidad comercial: revisa si existe evidencia real de que vende o fabrica el producto indicado; no confundas presencia web con capacidad tecnica.
6. Abre y cita las fuentes que sustentan cada hallazgo. Si no localizas una fuente oficial, marca el control como "No verificado".

Datos entregados por el usuario:
{json.dumps(payload, ensure_ascii=False, indent=2)}

Criterios minimos:
- Web o presencia digital coherente.
- Contacto verificable: dominio, correo corporativo, telefono, direccion, formulario, perfil B2B o registro publico.
- Senales de actividad comercial real.
- Coherencia entre empresa, pais, producto, rubro y datos de contacto.
- Riesgo de pago: cuentas personales, presion de pago, dominios recientes, falta de direccion, solo WhatsApp, inconsistencias de marca/producto.
- Recomendacion practica para el analista: avanzar, avanzar con cautela, pedir validacion o descartar.

Devuelve SOLO JSON valido:
{{
  "resumen": "1 frase ejecutiva",
  "analisis_escrito": "Informe de 2 a 4 parrafos: identidad observada, hallazgos de riesgo, limites de la investigacion y conclusion operativa. Cada afirmacion debe corresponder a una evidencia listada.",
  "riesgo": "Bajo/Medio/Alto",
  "decision": "Avanzar/Avanzar con cautela/Pedir validacion/Descartar",
  "confianza": "Alta/Media/Baja",
  "score_final": 0,
  "empresa": "Nombre normalizado",
  "website": "URL evaluada o No confirmado",
  "pais_region": "Pais/region observado o No confirmado",
  "identidad_legal": {{
    "estado": "Verificada/Parcial/No verificada",
    "detalle": "Que registro se encontro y que datos coinciden o faltan",
    "nombre_legal": "Razon social registrada o No confirmado",
    "numero_registro": "Numero oficial o No confirmado",
    "registro_consultado": "Nombre del registro oficial o No confirmado",
    "fuente_url": "URL directa de la fuente oficial o vacio",
    "coincidencias": ["dato que coincide"],
    "inconsistencias": ["dato contradictorio"]
  }},
  "sanciones": {{
    "estado": "Sin coincidencias/Posible coincidencia/Coincidencia confirmada/No verificado",
    "detalle": "Resultado limitado a las fuentes consultadas",
    "registro_consultado": "OFAC u otra lista oficial",
    "fuente_url": "URL de la consulta o fuente oficial",
    "hallazgos": ["coincidencia y elementos de identidad, si existen"]
  }},
  "reputacion_adversa": {{
    "estado": "Sin hallazgos adversos/Hallazgos no confirmados/Hallazgos oficiales/No verificado",
    "detalle": "Resumen sin convertir acusaciones no verificadas en hechos",
    "fuente_url": "URL principal",
    "hallazgos": ["hallazgo, fecha y naturaleza de la fuente"]
  }},
  "coherencia_datos": {{
    "estado": "Coherente/Parcial/Inconsistente/No verificado",
    "detalle": "Comparacion de datos declarados y observados",
    "coincidencias": ["dato consistente"],
    "inconsistencias": ["dato que debe aclararse"]
  }},
  "senal_positiva": [
    "senal concreta favorable"
  ],
  "senal_alerta": [
    "senal concreta de riesgo o dato no confirmado"
  ],
  "validaciones_pendientes": [
    "accion concreta antes de comprar/cotizar"
  ],
  "preguntas_al_proveedor": [
    "pregunta concreta para validar legitimidad o capacidad"
  ],
  "evidencia": [
    {{
      "titulo": "fuente o evidencia",
      "detalle": "que se observo o por que importa",
      "url": "URL directa si esta disponible",
      "categoria": "Registro empresarial/Sanciones/Reputacion/Identidad digital/Capacidad comercial",
      "nivel_fuente": "Oficial/Prensa confiable/Sitio corporativo/Queja no confirmada",
      "fecha_consulta": "fecha ISO de la consulta",
      "verificado": true
    }}
  ],
  "recomendacion_operativa": "Que debe hacer el analista ahora"
}}
"""
    client = get_gemini_client(gemini_key)
    tools = [types.Tool(googleSearch=types.GoogleSearch())] if use_google_search else None
    config = types.GenerateContentConfig(
        responseMimeType="application/json",
        tools=tools,
    )
    if not use_google_search:
        response, used_model = gemini_generate_with_fallback(client, prompt, response_mime_type="application/json")
    else:
        response = None
        used_model = ""
        for idx, model in enumerate(gemini_model_candidates()):
            try:
                response = client.models.generate_content(model=model, contents=prompt, config=config)
                used_model = model
                break
            except Exception as exc:
                if idx == len(gemini_model_candidates()) - 1:
                    raise
                if is_retryable_gemini_error(exc):
                    time.sleep(1 + idx)
                    continue
                raise
        if response is None:
            raise RuntimeError("No se pudo ejecutar auditoria con Gemini.")

    raw = str(getattr(response, "text", "") or "").strip().replace("```json", "").replace("```", "").strip()
    data = json.loads(raw)
    if not isinstance(data, dict):
        raise ValueError("La respuesta de auditoria no tiene formato valido.")
    data = _audit_normalize_ai_result(
        data,
        grounded=use_google_search,
        grounding_sources=_audit_grounding_sources(response) if use_google_search else [],
    )
    evidence = data.get("evidencia", [])
    evidence_count = len(evidence) if isinstance(evidence, list) else 0
    return data, evidence_count, used_model, getattr(response, "usage_metadata", None)

@app.post("/api/v1/login")
def login(req: LoginRequest, _token: str = Depends(verify_internal_token)):
    user = db.get_user(req.username, req.password)
    if user:
        db.log_usage_event(username=user[0], role=user[2], module="auth", action="api_login")
        return {"status": "success", "username": user[0], "role": user[2], "session_token": create_session_token(user[0], user[2])}
    db.log_usage_event(username=req.username, module="auth", action="api_login", status="error", error_message="Credenciales incorrectas")
    raise HTTPException(status_code=401, detail="Credenciales incorrectas")

@app.get("/api/v1/workspace/{username}")
def get_workspace(username: str, _token: str = Depends(verify_internal_token)):
    row = db.load_workspace_state(username)
    if row and row[0] and row[1]:
        df = pd.read_json(io.StringIO(row[0]))
        return {"cg": json.loads(row[1]), "items": df.to_dict(orient="records")}
    return {"cg": None, "items": []}

@app.get("/api/v1/history/{username}")
def get_history(username: str, skip: int = 0, limit: int = 50, _token: str = Depends(verify_internal_token)):
    df = db.get_user_history_df(username)
    return df.iloc[skip : skip+limit].to_dict(orient="records")

@app.get("/api/v1/inbox/{licitacion}")
def get_inbox(licitacion: str, skip: int = 0, limit: int = 50, _token: str = Depends(verify_internal_token)):
    df = db.get_correos_licitacion_df(licitacion)
    return df.iloc[skip : skip+limit].to_dict(orient="records")

@app.get("/api/v1/configuracion/{username}")
def get_config(username: str, _token: str = Depends(verify_internal_token)):
    user_creds = db.get_user_credentials(username)
    global_gemini = db.get_system_setting_status("gemini_key")
    global_tavily = db.get_system_setting_status("tavily_key")
    if user_creds:
        user_gemini = bool(user_creds[2])
        user_tavily = bool(user_creds[3]) if len(user_creds) > 3 else False
        return {
            "status": "success",
            "email_user": user_creds[0],
            "gemini_key": user_creds[2],
            "tavily_key": user_creds[3] if len(user_creds) > 3 else "",
            "has_gemini_key": user_gemini or global_gemini["configured"],
            "gemini_source": "usuario" if user_gemini else ("admin_global" if global_gemini["configured"] else "sin_configurar"),
            "has_tavily_key": user_tavily or global_tavily["configured"],
            "tavily_source": "usuario" if user_tavily else ("admin_global" if global_tavily["configured"] else "sin_configurar"),
        }
    return {
        "status": "error",
        "has_gemini_key": global_gemini["configured"],
        "gemini_source": "admin_global" if global_gemini["configured"] else "sin_configurar",
        "has_tavily_key": global_tavily["configured"],
        "tavily_source": "admin_global" if global_tavily["configured"] else "sin_configurar",
    }

@app.post("/api/v1/configuracion")
def save_config(
    username: str = Form(...),
    gemini_key: str = Form(...),
    email_user: str = Form(""),
    email_pass: str = Form(""),
    _token: str = Depends(verify_internal_token)
):
    existing = db.get_user_credentials(username)
    if not existing:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")

    enc_pass = existing[1]
    if email_pass:
        enc_pass = crypto.encrypt_data(email_pass)
        
    existing_tavily = existing[3] if len(existing) > 3 else ""

    db.update_user_profile(username, gemini_key, existing_tavily, email_user, enc_pass)
    return {"status": "success"}

@app.get("/api/v1/admin/users")
def admin_users(_admin: Dict[str, Any] = Depends(require_admin_session)):
    df = db.get_all_users()
    return {"status": "success", "users": _json_records(df)}

@app.get("/api/v1/admin/api-keys")
def admin_api_keys(_admin: Dict[str, Any] = Depends(require_admin_session)):
    return {
        "status": "success",
        "gemini": db.get_system_setting_status("gemini_key"),
        "tavily": db.get_system_setting_status("tavily_key"),
    }

@app.get("/api/v1/admin/api-pricing")
def admin_api_pricing(_admin: Dict[str, Any] = Depends(require_admin_session)):
    df = db.get_api_pricing_df()
    return {"status": "success", "pricing": _json_records(df)}

@app.post("/api/v1/admin/api-keys")
def admin_update_api_keys(req: AdminApiKeysRequest, _admin: Dict[str, Any] = Depends(require_admin_session)):
    gemini_key = str(req.gemini_key or "").strip()
    tavily_key = str(req.tavily_key or "").strip()
    if not gemini_key and not tavily_key:
        raise HTTPException(status_code=400, detail="Debes enviar al menos una API Key.")
    if gemini_key:
        db.set_system_setting("gemini_key", gemini_key, req.updated_by or "Admin")
    if tavily_key:
        db.set_system_setting("tavily_key", tavily_key, req.updated_by or "Admin")
    return {
        "status": "success",
        "gemini": db.get_system_setting_status("gemini_key"),
        "tavily": db.get_system_setting_status("tavily_key"),
    }

@app.post("/api/v1/admin/users/{username}/api-keys")
def admin_update_user_api_keys(username: str, req: AdminUserApiKeysRequest, _admin: Dict[str, Any] = Depends(require_admin_session)):
    gemini_key = req.gemini_key.strip() if isinstance(req.gemini_key, str) else None
    tavily_key = req.tavily_key.strip() if isinstance(req.tavily_key, str) else None
    if gemini_key is None and tavily_key is None:
        raise HTTPException(status_code=400, detail="Debes enviar al menos una API Key.")
    changed = db.update_user_api_keys(username, gemini=gemini_key, tavily=tavily_key)
    if not changed:
        raise HTTPException(status_code=404, detail="Usuario no encontrado.")
    return {"status": "success"}

@app.post("/api/v1/admin/users")
def admin_create_user(req: AdminCreateUserRequest, _admin: Dict[str, Any] = Depends(require_admin_session)):
    username = str(req.username or "").strip()
    password = str(req.password or "").strip()
    role = str(req.role or "Analista").strip()
    if not username or not password:
        raise HTTPException(status_code=400, detail="Usuario y contraseña son obligatorios.")
    created = db.create_user(username, password, role)
    if not created:
        raise HTTPException(status_code=409, detail="El usuario ya existe.")
    return {"status": "success"}

@app.post("/api/v1/admin/users/{username}/role")
def admin_update_role(username: str, req: AdminUpdateRoleRequest, _admin: Dict[str, Any] = Depends(require_admin_session)):
    if username.lower() == "admin":
        raise HTTPException(status_code=400, detail="No se puede cambiar el rol del administrador maestro.")
    db.update_user_role(username, req.role)
    return {"status": "success"}

@app.post("/api/v1/admin/users/{username}/password")
def admin_reset_password(username: str, req: AdminResetPasswordRequest, _admin: Dict[str, Any] = Depends(require_admin_session)):
    if not str(req.password or "").strip():
        raise HTTPException(status_code=400, detail="La contraseña nueva es obligatoria.")
    db.reset_user_password(username, req.password)
    return {"status": "success"}

@app.delete("/api/v1/admin/users/{username}")
def admin_delete_user(username: str, _admin: Dict[str, Any] = Depends(require_admin_session)):
    deleted = db.delete_user(username)
    if not deleted:
        raise HTTPException(status_code=400, detail="No se pudo eliminar este usuario.")
    return {"status": "success"}

@app.get("/api/v1/metrics/usage")
def metrics_usage(
    days: int = Query(30, ge=1, le=365),
    username: Optional[str] = Query(None),
    module: Optional[str] = Query(None),
    _session: Dict[str, Any] = Depends(require_management_session),
):
    summary = db.get_usage_summary(days=days, username=username, module=module)
    options = db.get_usage_filter_options(days=max(days, 30))
    return {"status": "success", "summary": _json_summary(summary), "options": _radar_json_safe(options)}


UPS_SERVICE_NAMES = {
    "01": "UPS Next Day Air",
    "02": "UPS 2nd Day Air",
    "03": "UPS Ground",
    "07": "UPS Worldwide Express",
    "08": "UPS Worldwide Expedited",
    "11": "UPS Standard",
    "12": "UPS 3 Day Select",
    "13": "UPS Next Day Air Saver",
    "14": "UPS Next Day Air Early",
    "54": "UPS Worldwide Express Plus",
    "59": "UPS 2nd Day Air A.M.",
    "65": "UPS Worldwide Saver",
}
_UPS_TOKEN_CACHE = {"environment": "", "access_token": "", "expires_at": 0.0}
_GEOAPIFY_CACHE: Dict[str, Dict[str, Any]] = {}
_GEOAPIFY_CACHE_LOCK = threading.Lock()
_SHIPSTATION_CARRIER_CACHE: Dict[str, Any] = {"expires_at": 0.0, "carriers": []}
_SHIPSTATION_CARRIER_CACHE_LOCK = threading.Lock()


def _carrier_decimal(value: Any, default: str = "0") -> Decimal:
    if isinstance(value, dict):
        value = value.get("MonetaryValue", value.get("amount", value.get("value", default)))
    try:
        return Decimal(str(value if value not in (None, "") else default))
    except (InvalidOperation, ValueError, TypeError):
        return Decimal(default)


def _carrier_error_message(response: requests.Response, carrier: str) -> str:
    try:
        payload = response.json()
    except Exception:
        payload = {}
    candidates = []
    if isinstance(payload, dict):
        response_node = payload.get("response") or payload.get("Response") or {}
        errors = response_node.get("errors") or response_node.get("Errors") or payload.get("errors") or []
        if isinstance(errors, dict):
            errors = [errors]
        for error in errors:
            if isinstance(error, dict):
                candidates.append(error.get("message") or error.get("Message") or error.get("description"))
        candidates.extend([payload.get("message"), payload.get("detail"), payload.get("title")])
    message = next((str(item).strip() for item in candidates if item), "")
    normalized = re.sub(r"[^a-z0-9]+", "", message.lower())
    if carrier == "UPS" and ("clientid" in normalized or "invalidclient" in normalized):
        return (
            "UPS rechazo el Client ID. Verifica que UPS_CLIENT_ID sea el Client ID OAuth de la "
            "aplicacion creada en UPS Developer Portal, que UPS_CLIENT_SECRET corresponda a esa "
            "misma aplicacion y que UPS_ENVIRONMENT sea sandbox o production segun corresponda."
        )
    if carrier == "Geoapify" and ("apikey" in normalized or "unauthorized" in normalized or response.status_code in {401, 403}):
        return "Geoapify rechazo la API key. Verifica GEOAPIFY_API_KEY en el backend de Railway y reinicia el servicio."
    if carrier == "ShipStation" and response.status_code in {401, 403}:
        return "ShipStation rechazo la API key. Verifica SHIPSTATION_API_KEY en el backend de Railway y reinicia el servicio."
    return message or f"{carrier} rechazo la solicitud (HTTP {response.status_code})."


def _shipstation_api_key() -> str:
    api_key = os.getenv("SHIPSTATION_API_KEY", "").strip()
    if not api_key:
        raise HTTPException(status_code=503, detail="ShipStation no esta configurado. Agrega SHIPSTATION_API_KEY en Railway.")
    return api_key


def _shipstation_base_url() -> str:
    return os.getenv("SHIPSTATION_API_BASE_URL", "https://api.shipengine.com/v1").strip().rstrip("/")


def _shipstation_environment() -> str:
    return "sandbox" if _shipstation_api_key().upper().startswith("TEST_") else "production"


def _shipstation_headers() -> Dict[str, str]:
    return {"API-Key": _shipstation_api_key(), "Content-Type": "application/json"}


def _shipstation_carriers() -> List[Dict[str, Any]]:
    now = time.time()
    with _SHIPSTATION_CARRIER_CACHE_LOCK:
        cached = list(_SHIPSTATION_CARRIER_CACHE.get("carriers") or [])
        if cached and float(_SHIPSTATION_CARRIER_CACHE.get("expires_at") or 0) > now:
            return cached
    try:
        response = requests.get(
            f"{_shipstation_base_url()}/carriers",
            headers=_shipstation_headers(),
            timeout=25,
        )
    except requests.RequestException as exc:
        raise HTTPException(status_code=502, detail=f"No fue posible consultar transportistas en ShipStation: {user_friendly_external_error(exc, 'ShipStation')}.")
    if not response.ok:
        raise HTTPException(status_code=response.status_code, detail=_carrier_error_message(response, "ShipStation"))
    payload = response.json()
    carriers = payload.get("carriers") if isinstance(payload, dict) else []
    normalized = []
    for carrier in carriers or []:
        if not isinstance(carrier, dict) or not str(carrier.get("carrier_id") or "").strip():
            continue
        if str(carrier.get("connection_status") or "approved").lower() not in {"", "approved"}:
            continue
        normalized.append({
            "carrier_id": str(carrier.get("carrier_id")),
            "carrier_code": str(carrier.get("carrier_code") or ""),
            "friendly_name": str(carrier.get("friendly_name") or carrier.get("nickname") or carrier.get("carrier_code") or "Transportista"),
        })
    if not normalized:
        raise HTTPException(status_code=422, detail="ShipStation no tiene transportistas disponibles. Activa al menos un carrier en tu cuenta.")
    with _SHIPSTATION_CARRIER_CACHE_LOCK:
        _SHIPSTATION_CARRIER_CACHE.update({"expires_at": now + 600, "carriers": normalized})
    return normalized


def _normalize_us_phone(value: str, label: str) -> str:
    digits = re.sub(r"\D", "", str(value or ""))
    if len(digits) == 11 and digits.startswith("1"):
        digits = digits[1:]
    if len(digits) != 10:
        raise HTTPException(
            status_code=400,
            detail=f"{label}: ingresa un telefono valido de Estados Unidos de 10 digitos.",
        )
    return f"+1{digits}"


def _shipstation_address_payload(address: LogisticsAddressRequest, fallback_name: str, label: str) -> Dict[str, Any]:
    name = str(address.name or fallback_name).strip()
    return {
        "name": name,
        "company_name": name,
        "phone": _normalize_us_phone(address.phone, label),
        "address_line1": str(address.address_line or "").strip(),
        "city_locality": str(address.city or "").strip(),
        "state_province": str(address.state or "").strip().upper(),
        "postal_code": str(address.postal_code or "").strip(),
        "country_code": "US",
        "address_residential_indicator": "yes" if address.residential else "no",
    }


def _shipstation_packages(packages: List[LogisticsPackageRequest]) -> List[Dict[str, Any]]:
    result = []
    for package in packages:
        payload = {
            "package_code": "package",
            "weight": {
                "value": float(package.weight),
                "unit": "kilogram" if str(package.weight_unit).upper() == "KGS" else "pound",
            },
            "dimensions": {
                "unit": "centimeter" if str(package.dimension_unit).upper() == "CM" else "inch",
                "length": float(package.length),
                "width": float(package.width),
                "height": float(package.height),
            },
        }
        if package.description:
            payload["label_messages"] = {"reference1": str(package.description)[:50]}
        result.extend([dict(payload) for _ in range(max(1, int(package.quantity)))])
    return result


def _normalize_shipstation_quotes(payload: Dict[str, Any], carriers: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    carrier_names = {str(item.get("carrier_id")): str(item.get("friendly_name") or "Transportista") for item in carriers}
    response_node = payload.get("rate_response") if isinstance(payload, dict) else {}
    rates = response_node.get("rates") if isinstance(response_node, dict) else []
    quotes = []
    for rate in rates or []:
        if not isinstance(rate, dict):
            continue
        shipping = _carrier_decimal(rate.get("shipping_amount"))
        insurance = _carrier_decimal(rate.get("insurance_amount"))
        confirmation = _carrier_decimal(rate.get("confirmation_amount"))
        other = _carrier_decimal(rate.get("other_amount"))
        total = shipping + insurance + confirmation + other
        if total <= 0:
            continue
        carrier_id = str(rate.get("carrier_id") or "")
        attributes = rate.get("rate_attributes") or []
        if isinstance(attributes, str):
            attributes = [attributes]
        quotes.append({
            "id": str(rate.get("rate_id") or f"shipstation-{len(quotes) + 1}"),
            "carrier": str(rate.get("carrier_friendly_name") or carrier_names.get(carrier_id) or rate.get("carrier_code") or "Transportista"),
            "carrier_id": carrier_id,
            "service_code": str(rate.get("service_code") or ""),
            "service_name": str(rate.get("service_type") or rate.get("service_code") or "Servicio disponible"),
            "total": float(total),
            "currency": str((rate.get("shipping_amount") or {}).get("currency") or "USD").upper(),
            "business_days": int(rate.get("delivery_days") or 0),
            "delivery_date": str(rate.get("estimated_delivery_date") or ""),
            "negotiated": str(rate.get("rate_type") or "").lower() not in {"", "retail"},
            "attributes": [str(item) for item in attributes if item],
            "shipping_amount": float(shipping),
            "other_amount": float(insurance + confirmation + other),
        })
    return sorted(quotes, key=lambda item: (float(item.get("total") or 0), int(item.get("business_days") or 9999)))


def _validate_domestic_address(address: LogisticsAddressRequest, label: str) -> None:
    country = str(address.country_code or "US").strip().upper()
    if country != "US":
        raise HTTPException(status_code=400, detail=f"{label}: esta calculadora solo admite direcciones dentro de Estados Unidos.")
    if not re.fullmatch(r"\d{5}(?:-\d{4})?", str(address.postal_code or "").strip()):
        raise HTTPException(status_code=400, detail=f"{label}: ingresa un ZIP Code valido de 5 o 9 digitos.")
    if not str(address.city or "").strip() or not re.fullmatch(r"[A-Za-z]{2}", str(address.state or "").strip()):
        raise HTTPException(status_code=400, detail=f"{label}: ciudad y estado de dos letras son obligatorios.")


def _validate_packages(packages: List[LogisticsPackageRequest]) -> None:
    total = sum(max(0, int(package.quantity or 0)) for package in packages)
    if not packages or total < 1:
        raise HTTPException(status_code=400, detail="Agrega al menos un paquete para cotizar.")
    if total > 50:
        raise HTTPException(status_code=400, detail="La cotizacion admite hasta 50 piezas por solicitud.")
    for package in packages:
        if package.weight <= 0 or min(package.length, package.width, package.height) <= 0:
            raise HTTPException(status_code=400, detail="Peso y dimensiones deben ser mayores que cero en cada paquete.")


def _ups_environment() -> str:
    return "production" if os.getenv("UPS_ENVIRONMENT", "sandbox").strip().lower() in {"production", "prod", "live"} else "sandbox"


def _ups_urls() -> Dict[str, str]:
    if _ups_environment() == "production":
        return {
            "token": "https://onlinetools.ups.com/security/v1/oauth/token",
            "api": "https://onlinetools.ups.com/api",
        }
    return {
        "token": "https://wwwcie.ups.com/security/v1/oauth/token",
        "api": "https://wwwcie.ups.com/api",
    }


def _ups_access_token() -> str:
    client_id = os.getenv("UPS_CLIENT_ID", "").strip()
    client_secret = os.getenv("UPS_CLIENT_SECRET", "").strip()
    if not client_id or not client_secret:
        raise HTTPException(status_code=503, detail="UPS no esta configurado. Logistica debe registrar UPS_CLIENT_ID y UPS_CLIENT_SECRET en Railway.")
    environment = _ups_environment()
    if _UPS_TOKEN_CACHE["environment"] == environment and _UPS_TOKEN_CACHE["access_token"] and float(_UPS_TOKEN_CACHE["expires_at"]) > time.time() + 60:
        return str(_UPS_TOKEN_CACHE["access_token"])
    try:
        response = requests.post(
            _ups_urls()["token"],
            auth=(client_id, client_secret),
            data={"grant_type": "client_credentials"},
            headers={"Content-Type": "application/x-www-form-urlencoded", "x-merchant-id": os.getenv("UPS_ACCOUNT_NUMBER", "").strip()},
            timeout=25,
        )
    except requests.RequestException as exc:
        raise HTTPException(status_code=502, detail=f"No fue posible conectar con la autenticacion de UPS: {user_friendly_external_error(exc, 'UPS')}.")
    if not response.ok:
        raise HTTPException(status_code=response.status_code, detail=_carrier_error_message(response, "UPS"))
    payload = response.json()
    token = str(payload.get("access_token") or "").strip()
    if not token:
        raise HTTPException(status_code=502, detail="UPS no devolvio un token de acceso valido.")
    _UPS_TOKEN_CACHE.update({
        "environment": environment,
        "access_token": token,
        "expires_at": time.time() + int(payload.get("expires_in") or 3600),
    })
    return token


def _ups_address_payload(address: LogisticsAddressRequest) -> Dict[str, Any]:
    result = {
        "AddressLine": [str(address.address_line or "").strip()] if str(address.address_line or "").strip() else [],
        "City": str(address.city or "").strip(),
        "StateProvinceCode": str(address.state or "").strip().upper(),
        "PostalCode": str(address.postal_code or "").strip(),
        "CountryCode": "US",
    }
    if address.residential:
        result["ResidentialAddressIndicator"] = "Y"
    return result


def _ups_package_payload(package: LogisticsPackageRequest) -> Dict[str, Any]:
    return {
        "PackagingType": {"Code": str(package.package_type or "02"), "Description": package.description or "Package"},
        "Dimensions": {
            "UnitOfMeasurement": {"Code": str(package.dimension_unit or "IN").upper()},
            "Length": f"{package.length:g}",
            "Width": f"{package.width:g}",
            "Height": f"{package.height:g}",
        },
        "PackageWeight": {
            "UnitOfMeasurement": {"Code": str(package.weight_unit or "LBS").upper()},
            "Weight": f"{package.weight:g}",
        },
    }


def _normalize_ups_quotes(payload: Dict[str, Any]) -> List[Dict[str, Any]]:
    rate_response = payload.get("RateResponse") or payload.get("rateResponse") or {}
    shipments = rate_response.get("RatedShipment") or rate_response.get("ratedShipment") or []
    if isinstance(shipments, dict):
        shipments = [shipments]
    quotes = []
    for shipment in shipments:
        if not isinstance(shipment, dict):
            continue
        service = shipment.get("Service") or shipment.get("service") or {}
        code = str(service.get("Code") or service.get("code") or "")
        negotiated = shipment.get("NegotiatedRateCharges") or {}
        charge = negotiated.get("TotalCharge") or shipment.get("TotalCharges") or {}
        total = _carrier_decimal(charge)
        currency = str(charge.get("CurrencyCode") or charge.get("currencyCode") or "USD") if isinstance(charge, dict) else "USD"
        transit = shipment.get("TimeInTransit") or {}
        service_summary = transit.get("ServiceSummary") or {}
        arrival = service_summary.get("EstimatedArrival") or {}
        arrival_node = arrival.get("Arrival") or {}
        quotes.append({
            "id": f"ups-{code}-{len(quotes) + 1}",
            "carrier": "UPS",
            "service_code": code,
            "service_name": str(service.get("Description") or UPS_SERVICE_NAMES.get(code) or f"UPS servicio {code}"),
            "total": float(total),
            "currency": currency,
            "business_days": int(arrival.get("BusinessDaysInTransit") or 0),
            "delivery_date": str(arrival_node.get("Date") or arrival.get("Date") or ""),
            "delivery_time": str(arrival_node.get("Time") or arrival.get("Time") or ""),
            "negotiated": bool(negotiated),
        })
    return sorted(quotes, key=lambda item: item["total"] if item["total"] > 0 else float("inf"))


def _schneider_authorization() -> str:
    bearer = os.getenv("SCHNEIDER_BEARER_TOKEN", "").strip()
    if bearer:
        return f"Bearer {bearer}"
    client_id = os.getenv("SCHNEIDER_CLIENT_ID", "").strip()
    client_secret = os.getenv("SCHNEIDER_CLIENT_SECRET", "").strip()
    if not client_id or not client_secret:
        raise HTTPException(status_code=503, detail="Schneider no esta configurado. Registra sus credenciales de API en Railway.")
    encoded = base64.b64encode(f"{client_id}:{client_secret}".encode("utf-8")).decode("ascii")
    return f"Basic {encoded}"


def _schneider_address_payload(address: LogisticsAddressRequest) -> Dict[str, Any]:
    return {
        "name": str(address.name or "").strip(),
        "addressLine1": str(address.address_line or "").strip(),
        "city": str(address.city or "").strip(),
        "state": str(address.state or "").strip().upper(),
        "postalCode": str(address.postal_code or "").strip(),
        "country": "US",
    }


def _normalize_schneider_quote(payload: Dict[str, Any]) -> Dict[str, Any]:
    quote = payload.get("quote") if isinstance(payload.get("quote"), dict) else payload
    total_node = quote.get("totalPrice", quote.get("total", 0))
    currency = "USD"
    if isinstance(total_node, dict):
        currency = str(total_node.get("currency") or total_node.get("currencyCode") or "USD")
    return {
        "id": str(quote.get("quoteId") or quote.get("id") or f"schneider-{uuid.uuid4().hex[:8]}"),
        "carrier": "Schneider",
        "service_code": str(quote.get("mode") or ""),
        "service_name": str(quote.get("serviceName") or quote.get("mode") or "Schneider domestic freight"),
        "total": float(_carrier_decimal(total_node)),
        "currency": currency,
        "line_haul": float(_carrier_decimal(quote.get("lineHaul", 0))),
        "fuel": float(_carrier_decimal(quote.get("fuel", 0))),
        "accessorials": float(_carrier_decimal(quote.get("accessorials", 0))),
        "transit_days": int(quote.get("transitDays") or 0),
        "pickup_at": str(quote.get("startDateTime") or ""),
        "delivery_at": str(quote.get("endDateTime") or ""),
        "expires_at": str(quote.get("quoteExpiration") or ""),
        "accessorial_list": quote.get("accessorialList") if isinstance(quote.get("accessorialList"), list) else [],
    }


def _geoapify_suggestions(query: str) -> List[Dict[str, Any]]:
    cache_key = re.sub(r"\s+", " ", str(query or "").strip().lower())
    with _GEOAPIFY_CACHE_LOCK:
        cached = _GEOAPIFY_CACHE.get(cache_key)
        if cached and float(cached.get("expires_at") or 0) > time.time():
            return list(cached.get("results") or [])

    api_key = os.getenv("GEOAPIFY_API_KEY", "").strip()
    if not api_key:
        raise HTTPException(status_code=503, detail="El autocompletado de direcciones no esta configurado. Agrega GEOAPIFY_API_KEY en Railway.")
    try:
        response = requests.get(
            "https://api.geoapify.com/v1/geocode/autocomplete",
            params={
                "text": str(query or "").strip(),
                "format": "json",
                "filter": "countrycode:us",
                "limit": 5,
                "lang": "en",
                "apiKey": api_key,
            },
            timeout=20,
        )
    except requests.RequestException as exc:
        raise HTTPException(status_code=502, detail=f"No fue posible consultar direcciones: {user_friendly_external_error(exc, 'Geoapify')}.")
    if not response.ok:
        raise HTTPException(status_code=response.status_code, detail=_carrier_error_message(response, "Geoapify"))

    normalized = []
    for item in response.json().get("results", [])[:5]:
        if not isinstance(item, dict):
            continue
        country_code = str(item.get("country_code") or "").upper()
        if country_code and country_code != "US":
            continue
        state_code = str(item.get("state_code") or "").upper()
        if len(state_code) != 2:
            state_code = ""
        street = str(item.get("address_line1") or "").strip()
        if not street:
            house = str(item.get("housenumber") or "").strip()
            road = str(item.get("street") or "").strip()
            street = " ".join(part for part in [house, road] if part).strip()
        normalized.append({
            "id": str(item.get("place_id") or f"geo-{len(normalized) + 1}"),
            "formatted": str(item.get("formatted") or item.get("address_line1") or "").strip(),
            "address_line": street,
            "city": str(item.get("city") or item.get("town") or item.get("village") or item.get("county") or "").strip(),
            "state": state_code,
            "postal_code": str(item.get("postcode") or "").strip(),
            "country_code": "US",
            "latitude": item.get("lat"),
            "longitude": item.get("lon"),
            "confidence": item.get("rank", {}).get("confidence") if isinstance(item.get("rank"), dict) else None,
        })

    with _GEOAPIFY_CACHE_LOCK:
        if len(_GEOAPIFY_CACHE) >= 200:
            oldest = min(_GEOAPIFY_CACHE, key=lambda key: float(_GEOAPIFY_CACHE[key].get("expires_at") or 0))
            _GEOAPIFY_CACHE.pop(oldest, None)
        _GEOAPIFY_CACHE[cache_key] = {"expires_at": time.time() + 86400, "results": normalized}
    return normalized


@app.get("/api/v1/logistics/carriers/status")
def logistics_carriers_status(_token: str = Depends(verify_internal_token)):
    ups_ready = bool(os.getenv("UPS_CLIENT_ID", "").strip() and os.getenv("UPS_CLIENT_SECRET", "").strip())
    shipstation_key = os.getenv("SHIPSTATION_API_KEY", "").strip()
    schneider_ready = bool(
        os.getenv("SCHNEIDER_SUBSCRIPTION_KEY", "").strip()
        and (os.getenv("SCHNEIDER_BEARER_TOKEN", "").strip() or (os.getenv("SCHNEIDER_CLIENT_ID", "").strip() and os.getenv("SCHNEIDER_CLIENT_SECRET", "").strip()))
        and (os.getenv("SCHNEIDER_SCAC", "").strip())
    )
    return {
        "status": "success",
        "carriers": {
            "shipstation": {"configured": bool(shipstation_key), "environment": "sandbox" if shipstation_key.upper().startswith("TEST_") else "production", "official": True},
            "ups": {"configured": ups_ready, "environment": _ups_environment(), "official": True},
            "schneider": {"configured": schneider_ready, "environment": os.getenv("SCHNEIDER_ENVIRONMENT", "production"), "official": True},
            "address_autocomplete": {"configured": bool(os.getenv("GEOAPIFY_API_KEY", "").strip()), "environment": "Geoapify", "official": True},
        },
    }


@app.get("/api/v1/logistics/addresses/autocomplete")
def logistics_address_autocomplete(
    q: str = Query(..., min_length=3, max_length=160),
    _token: str = Depends(verify_internal_token),
):
    return {"status": "success", "provider": "Geoapify", "suggestions": _geoapify_suggestions(q)}


@app.post("/api/v1/logistics/quotes/shipstation")
def logistics_quote_shipstation(req: ShipStationQuoteRequest, _token: str = Depends(verify_internal_token)):
    _validate_domestic_address(req.origin, "Origen")
    _validate_domestic_address(req.destination, "Destino")
    _normalize_us_phone(req.origin.phone, "Origen")
    _normalize_us_phone(req.destination.phone, "Destino")
    _validate_packages(req.packages)
    carriers = _shipstation_carriers()
    request_payload = {
        "rate_options": {
            "carrier_ids": [str(carrier["carrier_id"]) for carrier in carriers],
        },
        "shipment": {
            "validate_address": "validate_and_clean",
            "ship_date": req.pickup_date or datetime.now().strftime("%Y-%m-%d"),
            "ship_from": _shipstation_address_payload(req.origin, "Proveedor", "Origen"),
            "ship_to": _shipstation_address_payload(req.destination, "Forwarder", "Destino"),
            "packages": _shipstation_packages(req.packages),
        },
    }
    if req.declared_value > 0:
        request_payload["shipment"]["insurance_provider"] = "carrier"
        request_payload["shipment"]["packages"][0]["insured_value"] = {
            "currency": "usd",
            "amount": float(req.declared_value),
        }
    try:
        response = requests.post(
            f"{_shipstation_base_url()}/rates",
            headers=_shipstation_headers(),
            json=request_payload,
            timeout=55,
        )
    except requests.RequestException as exc:
        raise HTTPException(status_code=502, detail=f"No fue posible conectar con ShipStation: {user_friendly_external_error(exc, 'ShipStation')}.")
    if not response.ok:
        raise HTTPException(status_code=response.status_code, detail=_carrier_error_message(response, "ShipStation"))
    quotes = _normalize_shipstation_quotes(response.json(), carriers)
    if not quotes:
        raise HTTPException(status_code=422, detail="ShipStation no devolvio tarifas para esta ruta. Revisa direcciones, medidas y transportistas activos.")
    return {
        "status": "success",
        "provider": "ShipStation API",
        "official": True,
        "environment": _shipstation_environment(),
        "quotes": quotes,
        "carriers_consulted": len(carriers),
        "read_only": True,
    }


@app.post("/api/v1/logistics/quotes/ups")
def logistics_quote_ups(req: UpsQuoteRequest, _token: str = Depends(verify_internal_token)):
    _validate_domestic_address(req.origin, "Origen")
    _validate_domestic_address(req.destination, "Destino")
    _validate_packages(req.packages)
    shipper_number = str(req.shipper_number or os.getenv("UPS_ACCOUNT_NUMBER", "")).strip()
    package_payloads = []
    for package in req.packages:
        package_payloads.extend([_ups_package_payload(package) for _ in range(max(1, int(package.quantity)))])
    shipment = {
        "Shipper": {"Name": req.origin.name or "Supplier", "Address": _ups_address_payload(req.origin)},
        "ShipFrom": {"Name": req.origin.name or "Supplier", "Address": _ups_address_payload(req.origin)},
        "ShipTo": {"Name": req.destination.name or "Forwarder", "Address": _ups_address_payload(req.destination)},
        "NumOfPieces": str(len(package_payloads)),
        "Package": package_payloads,
        "DeliveryTimeInformation": {
            "PackageBillType": "03",
            "Pickup": {"Date": (req.pickup_date or datetime.now().strftime("%Y-%m-%d")).replace("-", ""), "Time": "1000"},
        },
    }
    if req.declared_value > 0:
        shipment["InvoiceLineTotal"] = {"CurrencyCode": "USD", "MonetaryValue": f"{req.declared_value:.2f}"}
    if shipper_number:
        shipment["Shipper"]["ShipperNumber"] = shipper_number
        shipment["PaymentDetails"] = {"ShipmentCharge": [{"Type": "01", "BillShipper": {"AccountNumber": shipper_number}}]}
        shipment["ShipmentRatingOptions"] = {"NegotiatedRatesIndicator": "Y"}
    request_payload = {
        "RateRequest": {
            "Request": {"RequestOption": "Shoptimeintransit", "TransactionReference": {"CustomerContext": f"Procura AI {req.licitacion or req.username}"}},
            "Shipment": shipment,
        }
    }
    try:
        response = requests.post(
            f"{_ups_urls()['api']}/rating/v2409/Shoptimeintransit",
            headers={
                "Authorization": f"Bearer {_ups_access_token()}",
                "Content-Type": "application/json",
                "transId": uuid.uuid4().hex[:32],
                "transactionSrc": "ProcuraAI",
            },
            json=request_payload,
            timeout=45,
        )
    except requests.RequestException as exc:
        raise HTTPException(status_code=502, detail=f"No fue posible conectar con UPS: {user_friendly_external_error(exc, 'UPS')}.")
    if not response.ok:
        raise HTTPException(status_code=response.status_code, detail=_carrier_error_message(response, "UPS"))
    provider_payload = response.json()
    quotes = _normalize_ups_quotes(provider_payload)
    if not quotes:
        raise HTTPException(status_code=502, detail="UPS respondio correctamente, pero no devolvio servicios cotizables para esta ruta.")
    return {"status": "success", "provider": "UPS", "official": True, "environment": _ups_environment(), "quotes": quotes}


@app.post("/api/v1/logistics/quotes/schneider")
def logistics_quote_schneider(req: SchneiderQuoteRequest, _token: str = Depends(verify_internal_token)):
    _validate_domestic_address(req.origin, "Origen")
    _validate_domestic_address(req.destination, "Destino")
    if not req.commodities:
        raise HTTPException(status_code=400, detail="Agrega al menos una mercancia para cotizar.")
    scac = str(req.scac or os.getenv("SCHNEIDER_SCAC", "")).strip()
    subscription_key = os.getenv("SCHNEIDER_SUBSCRIPTION_KEY", "").strip()
    if not scac or not subscription_key:
        raise HTTPException(status_code=503, detail="Schneider no esta configurado. Faltan SCHNEIDER_SCAC o SCHNEIDER_SUBSCRIPTION_KEY en Railway.")
    commodities = []
    for commodity in req.commodities:
        if commodity.weight <= 0 or commodity.quantity < 1:
            raise HTTPException(status_code=400, detail="Cantidad y peso deben ser mayores que cero en cada mercancia.")
        if str(req.mode or "").upper() == "LTL" and not str(commodity.freight_class or "").strip():
            raise HTTPException(status_code=400, detail="Schneider requiere Freight Class para una cotizacion LTL.")
        row = {
            "description": commodity.description,
            "count": commodity.quantity,
            "weight": {"value": commodity.weight, "unit": commodity.weight_unit.upper()},
            "hazardous": commodity.hazardous,
        }
        if commodity.length > 0 and commodity.width > 0 and commodity.height > 0:
            row["dimensions"] = {
                "length": commodity.length,
                "width": commodity.width,
                "height": commodity.height,
                "unit": commodity.dimension_unit.upper(),
            }
        if commodity.freight_class:
            row["freightClass"] = commodity.freight_class
        commodities.append(row)
    payload = {
        "scac": scac,
        "mode": str(req.mode or "LTL").upper(),
        "stops": [
            {"stopType": "PICKUP", "sequence": 1, "address": _schneider_address_payload(req.origin), "startDateTime": req.pickup_start, "endDateTime": req.pickup_end},
            {"stopType": "DELIVERY", "sequence": 2, "address": _schneider_address_payload(req.destination), "startDateTime": req.delivery_start, "endDateTime": req.delivery_end},
        ],
        "commodities": commodities,
    }
    if req.equipment:
        payload["equipment"] = req.equipment
    if req.services:
        payload["services"] = req.services
    if req.load_value > 0:
        payload["loadValue"] = {"amount": req.load_value, "currency": "USD"}
    base_url = os.getenv("SCHNEIDER_API_BASE_URL", "https://api.schneider.com/005/quote/v1").strip().rstrip("/")
    try:
        response = requests.post(
            f"{base_url}/quotes",
            headers={
                "Ocp-Apim-Subscription-Key": subscription_key,
                "Authorization": _schneider_authorization(),
                "Content-Type": "application/json",
            },
            json=payload,
            timeout=60,
        )
    except requests.RequestException as exc:
        raise HTTPException(status_code=502, detail=f"No fue posible conectar con Schneider: {user_friendly_external_error(exc, 'Schneider')}.")
    if not response.ok:
        raise HTTPException(status_code=response.status_code, detail=_carrier_error_message(response, "Schneider"))
    quote = _normalize_schneider_quote(response.json())
    if quote["total"] <= 0:
        raise HTTPException(status_code=502, detail="Schneider respondio, pero no devolvio un total cotizable. Revisa modo, SCAC y servicios autorizados.")
    return {"status": "success", "provider": "Schneider", "official": True, "environment": os.getenv("SCHNEIDER_ENVIRONMENT", "production"), "quotes": [quote]}

@app.get("/api/v1/logistics/settings")
def logistics_settings(_token: str = Depends(verify_internal_token)):
    return {
        "status": "success",
        "freight_rates": _json_records(db.get_logistics_freight_rates()),
        "local_rates": _json_records(db.get_logistics_local_rates()),
        "forwarders": _json_records(db.get_logistics_forwarders()),
        "incoterms": _json_records(db.get_logistics_incoterms()),
    }

@app.post("/api/v1/logistics/freight-rates")
def logistics_upsert_freight_rate(req: LogisticsFreightRateRequest, _session: Dict[str, Any] = Depends(require_logistics_admin_session)):
    if not str(req.agente or "").strip():
        raise HTTPException(status_code=400, detail="El agente/forwarder es obligatorio.")
    db.upsert_logistics_freight_rate(
        agente=req.agente.strip(),
        tipo_servicio=req.tipo_servicio.strip() or "USA-Panama",
        tipo_flete=req.tipo_flete.strip() or "Aereo",
        tarifa_por_libra=req.tarifa_por_libra,
        tiempo_transito_dias=req.tiempo_transito_dias,
        minimo_envio=req.minimo_envio,
        dia_corte=req.dia_corte.strip(),
        salidas=req.salidas.strip(),
        activo=req.activo,
    )
    return {"status": "success", "settings": logistics_settings()}

@app.post("/api/v1/logistics/local-rates")
def logistics_upsert_local_rate(req: LogisticsLocalRateRequest, _session: Dict[str, Any] = Depends(require_logistics_admin_session)):
    if not str(req.agente or "").strip():
        raise HTTPException(status_code=400, detail="El agente local es obligatorio.")
    if not str(req.destino or "").strip():
        raise HTTPException(status_code=400, detail="El destino es obligatorio.")
    db.upsert_logistics_local_rate(
        agente=req.agente.strip(),
        destino=req.destino.strip(),
        tipo_flete=req.tipo_flete.strip() or "Terrestre",
        hasta_400kg=req.hasta_400kg,
        kg_500_1000=req.kg_500_1000,
        mayor_1000kg=req.mayor_1000kg,
        activo=req.activo,
    )
    return {"status": "success", "settings": logistics_settings()}

@app.post("/api/v1/logistics/forwarders")
def logistics_upsert_forwarder(req: LogisticsForwarderRequest, _session: Dict[str, Any] = Depends(require_logistics_admin_session)):
    if not str(req.nombre or "").strip():
        raise HTTPException(status_code=400, detail="El nombre del forwarder es obligatorio.")
    db.upsert_logistics_forwarder(
        nombre=req.nombre.strip(),
        direccion=req.direccion.strip(),
        observacion=req.observacion.strip(),
        activo=req.activo,
    )
    return {"status": "success", "settings": logistics_settings()}
@app.get("/api/v1/logistics/calculations")
def logistics_calculations(limit: int = Query(100, ge=1, le=500), _token: str = Depends(verify_internal_token)):
    return {"status": "success", "calculations": _json_records(db.get_logistics_calculations(limit=limit))}

@app.post("/api/v1/logistics/calculations")
def logistics_save_calculation(req: LogisticsCalculationRequest, _token: str = Depends(verify_internal_token)):
    db.save_logistics_calculation(
        username=req.username,
        licitacion=req.licitacion,
        renglon=req.renglon,
        agente=req.agente,
        tipo_flete=req.tipo_flete,
        incoterm=req.incoterm,
        peso_libras=req.peso_libras,
        peso_kg=req.peso_kg,
        costo_internacional=req.costo_internacional,
        costo_local=req.costo_local,
        costo_total=req.costo_total,
        tiempo_transito_dias=req.tiempo_transito_dias,
        metadata=req.metadata,
        peso_facturable_libras=req.peso_facturable_libras,
        peso_volumetrico_libras=req.peso_volumetrico_libras,
        largo=req.largo,
        ancho=req.ancho,
        alto=req.alto,
        unidad_dimensional=req.unidad_dimensional,
    )
    return {"status": "success"}

@app.delete("/api/v1/logistics/calculations/{calculation_id}")
def logistics_delete_calculation(calculation_id: int, _token: str = Depends(verify_internal_token)):
    deleted = db.delete_logistics_calculation(calculation_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Calculo logistico no encontrado.")
    return {"status": "success"}

@app.post("/api/v1/sourcing/providers")
def sourcing_providers(req: SourcingRequest, _token: str = Depends(verify_internal_token)):
    started_at = time.perf_counter()
    api_key_clean = _resolve_gemini_key(req.username, req.gemini_key)
    target_count = max(3, min(10, int(req.target_count or 10)))
    contexts = [item.model_dump() for item in req.items[:12]]
    if not contexts:
        raise HTTPException(status_code=400, detail="No hay renglones para buscar proveedores.")
    if not api_key_clean:
        raise HTTPException(status_code=400, detail="Configura Gemini API Key en Admin o en el perfil del usuario.")

    all_rows = []
    summaries = []
    evidence_count = 0
    used_models = set()
    usage_metadata = None
    grounding_used = True

    try:
        integral_mode = str(req.sourcing_strategy or "").strip().lower() in {"proveedor_integral", "integral", "multi_renglon"} and len(contexts) > 1
        if integral_mode:
            try:
                summary, rows, urls_found, used_model, usage = _ai_find_integral_providers_with_gemini(
                    api_key_clean,
                    contexts,
                    custom_prompt=req.custom_prompt,
                    target_count=target_count,
                    use_google_search=True,
                )
            except Exception as exc:
                logger.warning(f"Sourcing integral con Google Search no disponible, usando Gemini sin grounding: {exc}")
                grounding_used = False
                summary, rows, urls_found, used_model, usage = _ai_find_integral_providers_with_gemini(
                    api_key_clean,
                    contexts,
                    custom_prompt=req.custom_prompt,
                    target_count=target_count,
                    use_google_search=False,
                )
            if summary:
                summaries.append(summary)
            all_rows.extend(rows)
            evidence_count += int(urls_found or 0)
            if used_model:
                used_models.add(used_model)
            if usage:
                usage_metadata = usage
        else:
            for ctx in contexts:
                try:
                    summary, rows, urls_found, used_model, usage = _ai_find_providers_with_gemini(
                        api_key_clean,
                        ctx,
                        custom_prompt=req.custom_prompt,
                        target_count=target_count,
                        use_google_search=True,
                    )
                except Exception as exc:
                    logger.warning(f"Sourcing con Google Search no disponible, usando Gemini sin grounding: {exc}")
                    grounding_used = False
                    summary, rows, urls_found, used_model, usage = _ai_find_providers_with_gemini(
                        api_key_clean,
                        ctx,
                        custom_prompt=req.custom_prompt,
                        target_count=target_count,
                        use_google_search=False,
                    )
                if summary:
                    summaries.append(summary)
                all_rows.extend(rows)
                evidence_count += int(urls_found or 0)
                if used_model:
                    used_models.add(used_model)
                if usage:
                    usage_metadata = usage

        if not all_rows:
            raise HTTPException(status_code=404, detail="No se pudieron generar proveedores utiles para esos renglones.")

        all_rows = [
            _normalize_sourcing_provider(
                row,
                context_count=len(contexts),
                expected_requirements=_provider_expected_requirement_count(row, contexts),
            )
            for row in all_rows
            if isinstance(row, dict)
        ]
        all_rows = [row for row in all_rows if row.get("url")]
        if not all_rows:
            raise HTTPException(
                status_code=404,
                detail="La busqueda no encontro candidatos con una fuente web verificable. Ajusta los renglones o la instruccion y vuelve a intentar.",
            )

        def sort_key(row):
            try:
                score = int(float(row.get("puntaje_ranking", 0) or 0))
            except Exception:
                score = 0
            return score

        def coverage_count(value):
            try:
                return int(float(value or 0))
            except (TypeError, ValueError):
                return 0

        ordered_rows = sorted(all_rows, key=sort_key, reverse=True)
        ranked = []
        provider_positions = {}
        for row in ordered_rows:
            url = str(row.get("url", "") or "").strip()
            domain = _audit_domain_from_url(_audit_normalize_url(url)) if url else ""
            normalized_name = unicodedata.normalize("NFKD", str(row.get("proveedor", "") or ""))
            normalized_name = "".join(char for char in normalized_name if not unicodedata.combining(char))
            normalized_name = re.sub(r"[^a-z0-9]+", " ", normalized_name.lower()).strip()
            provider_key = domain or normalized_name

            covered_rows = row.get("renglones_cubiertos") if isinstance(row.get("renglones_cubiertos"), list) else []
            if row.get("renglon") not in (None, ""):
                covered_rows = [*covered_rows, row.get("renglon")]
            covered_rows = list(dict.fromkeys(str(value).strip() for value in covered_rows if str(value).strip()))
            row["renglones_cubiertos"] = covered_rows
            row["cobertura_renglones"] = max(coverage_count(row.get("cobertura_renglones")), len(covered_rows))

            if provider_key and provider_key in provider_positions:
                existing = ranked[provider_positions[provider_key]]
                merged_rows = list(dict.fromkeys([
                    *(existing.get("renglones_cubiertos") or []),
                    *covered_rows,
                ]))
                existing["renglones_cubiertos"] = merged_rows
                existing["cobertura_renglones"] = max(
                    coverage_count(existing.get("cobertura_renglones")),
                    coverage_count(row.get("cobertura_renglones")),
                    len(merged_rows),
                )
                continue

            if not url:
                row["riesgo"] = "Alto"
                if "recomendado" in str(row.get("decision", "")).lower():
                    row["decision"] = "Validar antes de cotizar"
            if provider_key:
                provider_positions[provider_key] = len(ranked)
            ranked.append(row)
            if len(ranked) >= target_count:
                break

        ranked = [
            _normalize_sourcing_provider(
                row,
                context_count=len(contexts),
                expected_requirements=_provider_expected_requirement_count(row, contexts),
            )
            for row in ranked
        ]
        ranked.sort(key=sort_key, reverse=True)

        engine_name = "gemini_google_search" if grounding_used else "gemini_reasoning_without_grounding"
        tokens_input, tokens_output, tokens_total = db.extract_usage_counts(usage_metadata)
        db.log_usage_event(
            username=req.username,
            module="proveedores",
            action="sourcing_providers",
            provider="gemini",
            model=next(iter(used_models), GEMINI_MODEL),
            tokens_input=tokens_input,
            tokens_output=tokens_output,
            tokens_total=tokens_total,
            status="success",
            duration_ms=int((time.perf_counter() - started_at) * 1000),
            metadata={
                "cost_accuracy": "input_output_tokens",
                "evidence_count": evidence_count,
                "items": len(contexts),
                "target_count": target_count,
                "engine": engine_name,
                "search_requests": 1 if integral_mode else len(contexts),
                "sourcing_strategy": "proveedor_integral" if integral_mode else "por_renglon",
            },
        )
        return {
            "status": "success",
            "resumen": " ".join(summaries[:3]) or ("Ranking integral generado con Gemini." if integral_mode else "Ranking preliminar generado con Gemini."),
            "proveedores": _radar_json_safe(ranked),
            "evidence_count": evidence_count,
            "engine": engine_name,
            "search_plan": [_manual_sourcing_plan(ctx, custom_prompt=req.custom_prompt, depth=req.depth) for ctx in contexts],
        }
    except HTTPException:
        raise
    except Exception as exc:
        detail = user_friendly_external_error(exc, context="Gemini sourcing")
        db.log_usage_event(
            username=req.username,
            module="proveedores",
            action="sourcing_providers",
            provider="gemini",
            model=GEMINI_MODEL if api_key_clean else "",
            status="error",
            error_message=detail[:500],
            duration_ms=int((time.perf_counter() - started_at) * 1000),
        )
        raise HTTPException(status_code=503, detail=detail)

@app.post("/api/v1/sourcing/audit-company")
def audit_company(req: CompanyAuditRequest, _token: str = Depends(verify_internal_token)):
    started_at = time.perf_counter()
    api_key_clean = _resolve_gemini_key(req.username, req.gemini_key)
    company_name = str(req.company_name or "").strip()
    if not company_name:
        raise HTTPException(status_code=400, detail="Indica el nombre de la empresa a auditar.")
    if not api_key_clean:
        raise HTTPException(status_code=400, detail="Configura Gemini API Key en Admin o en el perfil del usuario.")

    payload = {
        "company_name": company_name,
        "website": str(req.website or "").strip(),
        "country": str(req.country or "").strip(),
        "registration_id": str(req.registration_id or "").strip(),
        "tax_id": str(req.tax_id or "").strip(),
        "contact_email": str(req.contact_email or "").strip(),
        "contact_phone": str(req.contact_phone or "").strip(),
        "declared_address": str(req.declared_address or "").strip(),
        "product_context": str(req.product_context or "").strip(),
        "notes": str(req.notes or "").strip(),
    }
    technical_signals = _audit_collect_technical_signals(company_name, payload["website"])
    payload["technical_signals"] = technical_signals

    try:
        try:
            result, evidence_count, used_model, usage = _audit_company_with_gemini(api_key_clean, payload, use_google_search=True)
            engine = "gemini_google_search"
        except Exception as exc:
            logger.warning(f"Auditoria con Google Search no disponible, usando Gemini sin grounding: {exc}")
            result, evidence_count, used_model, usage = _audit_company_with_gemini(api_key_clean, payload, use_google_search=False)
            engine = "gemini"

        discovered_url = _audit_normalize_url(result.get("website", ""))
        discovered_domain = _audit_domain_from_url(discovered_url)
        if discovered_domain and discovered_domain != technical_signals.get("domain"):
            technical_signals = _audit_collect_technical_signals(company_name, discovered_url)

        scorecard = technical_signals.get("scorecard", {}) or {}
        result = _audit_add_technical_evidence(result, technical_signals)
        result = _audit_finalize_assessment(result, technical_signals, grounded=engine == "gemini_google_search")
        result["auditoria_tecnica"] = technical_signals
        result["riesgo_tecnico"] = scorecard.get("riesgo_tecnico")
        result["decision_tecnica"] = scorecard.get("decision_tecnica")
        if technical_signals.get("normalized_url"):
            result["website"] = technical_signals.get("normalized_url")

        technical_alerts = scorecard.get("alertas", []) or []
        technical_positives = scorecard.get("positivos", []) or []
        result["senal_alerta"] = list(dict.fromkeys([*(result.get("senal_alerta") or []), *technical_alerts]))
        result["senal_positiva"] = list(dict.fromkeys([*(result.get("senal_positiva") or []), *technical_positives]))

        evidence_count = len(result.get("evidencia", []) or [])
        tokens_input, tokens_output, tokens_total = db.extract_usage_counts(usage)
        db.log_usage_event(
            username=req.username,
            module="auditor_empresas",
            action="audit_company",
            provider="gemini",
            model=used_model or GEMINI_MODEL,
            tokens_input=tokens_input,
            tokens_output=tokens_output,
            tokens_total=tokens_total,
            status="success",
            duration_ms=int((time.perf_counter() - started_at) * 1000),
            metadata={
                "cost_accuracy": "input_output_tokens",
                "company": company_name,
                "engine": engine,
                "evidence_count": evidence_count,
                "technical_score": scorecard.get("score"),
                "domain": technical_signals.get("domain"),
            },
        )
        result["status"] = "success"
        result["engine"] = engine
        result["evidence_count"] = evidence_count
        audit_id = db.save_company_audit(
            username=req.username,
            company_name=company_name,
            website=result.get("website") or payload.get("website", ""),
            domain=technical_signals.get("domain", ""),
            country=result.get("pais_region") or payload.get("country", ""),
            product_context=payload.get("product_context", ""),
            notes=payload.get("notes", ""),
            result=result,
            technical=technical_signals,
        )
        result["audit_id"] = audit_id
        return _radar_json_safe(result)
    except HTTPException:
        raise
    except Exception as exc:
        detail = user_friendly_external_error(exc, context="Gemini auditoria empresa")
        db.log_usage_event(
            username=req.username,
            module="auditor_empresas",
            action="audit_company",
            provider="gemini",
            model=GEMINI_MODEL if api_key_clean else "",
            status="error",
            error_message=detail[:500],
            duration_ms=int((time.perf_counter() - started_at) * 1000),
            metadata={"company": company_name},
        )
        raise HTTPException(status_code=503, detail=detail)

@app.get("/api/v1/sourcing/company-audits")
def company_audits(
    search: str = Query("", max_length=160),
    limit: int = Query(100, ge=1, le=500),
    _token: str = Depends(verify_internal_token),
):
    df = db.get_company_audits(search=search, limit=limit)
    return {"status": "success", "audits": _json_records(df)}

@app.get("/api/v1/historico")
def historico_licitaciones(
    search: str = Query("", max_length=120),
    terms: str = Query("", max_length=1200),
    anio: str = Query("Todos"),
    limit: int = Query(500, ge=1, le=5000),
    _token: str = Depends(verify_internal_token),
):
    search_terms = list(dict.fromkeys(
        term.strip()
        for term in re.split(r"[\r\n|;]+", str(terms or ""))
        if term.strip()
    ))[:12]
    df = db.get_historico_licitaciones_df(
        limit=limit,
        search=search or None,
        searches=search_terms or None,
        anio=anio,
    )
    return {
        "status": "success",
        "count": db.get_historico_count(),
        "matched_count": db.get_historico_count(search=search or None, searches=search_terms or None, anio=anio),
        "years": _radar_json_safe(db.get_historico_anios()),
        "rows": _json_records(df),
    }

@app.get("/api/v1/workspaces/{username}/list")
def workspaces_list(
    username: str,
    all_users: bool = Query(False),
    _token: str = Depends(verify_internal_token),
):
    df = db.get_all_workspaces(username, all_users=all_users)
    return {"status": "success", "workspaces": _json_records(df)}

@app.post("/api/v1/workspaces")
def workspaces_save(req: WorkspaceSaveRequest, _token: str = Depends(verify_internal_token)):
    username = str(req.username or "").strip()
    cg = req.condiciones_generales or {}
    licitacion = str(req.licitacion or cg.get("numero_licitacion") or cg.get("licitacion") or "").strip()
    if not username:
        raise HTTPException(status_code=400, detail="Usuario requerido para guardar workspace.")
    if not licitacion:
        licitacion = f"workspace-{datetime.now().strftime('%Y%m%d-%H%M%S')}"
    db.save_workspace(
        username,
        licitacion,
        json.dumps(_radar_json_safe(req.data or []), ensure_ascii=False),
        json.dumps(_radar_json_safe(cg), ensure_ascii=False),
    )
    db.log_usage_event(
        username=username,
        module="workspace",
        action="save_workspace",
        licitacion=licitacion,
        metadata={"items": len(req.data or [])},
    )
    return {"status": "success", "licitacion": licitacion}

@app.get("/api/v1/workspaces/{username}/{licitacion}")
def workspaces_load(username: str, licitacion: str, _token: str = Depends(verify_internal_token)):
    row = db.load_workspace(username, licitacion)
    if not row:
        raise HTTPException(status_code=404, detail="Workspace no encontrado.")
    data_json, cg_json = row
    try:
        data = json.loads(data_json or "[]")
    except Exception:
        data = []
    try:
        cg = json.loads(cg_json or "{}")
    except Exception:
        cg = {}
    return {"status": "success", "data": _radar_json_safe(data), "condiciones_generales": _radar_json_safe(cg)}

@app.delete("/api/v1/workspaces/{username}/{licitacion}")
def workspaces_delete(username: str, licitacion: str, _token: str = Depends(verify_internal_token)):
    db.delete_workspace(username, licitacion)
    return {"status": "success"}

@app.get("/api/v1/seguimiento")
def seguimiento_list(
    username: str = Query("", max_length=120),
    role: str = Query("Analista", max_length=60),
    _token: str = Depends(verify_internal_token),
):
    if role == "Admin":
        return {"status": "success", "seguimientos": []}
    df = db.get_seguimientos(username=username, role=role)
    records = _json_records(df)
    for record in records:
        raw_snapshot = record.pop("sli_snapshot_json", "")
        if isinstance(raw_snapshot, dict):
            record["sli_snapshot"] = raw_snapshot
        else:
            try:
                record["sli_snapshot"] = json.loads(raw_snapshot) if raw_snapshot else None
            except (TypeError, ValueError, json.JSONDecodeError):
                record["sli_snapshot"] = None
    return {"status": "success", "seguimientos": records}

@app.post("/api/v1/seguimiento")
def seguimiento_create(req: SeguimientoCreateRequest, _token: str = Depends(verify_internal_token)):
    numero = "".join(filter(str.isdigit, str(req.numero_licitacion or "")))
    if not numero:
        raise HTTPException(status_code=400, detail="Numero de licitacion invalido.")
    seguimiento = db.crear_seguimiento(
        numero,
        req.objeto,
        req.fecha_asignacion,
        req.fecha_envio_oferta,
        req.monto_ofertado,
        req.moneda or "USD",
        req.link_sli,
        req.notas,
        req.responsable,
        req.owner_username or req.responsable,
    )
    if not seguimiento:
        raise HTTPException(status_code=500, detail="No se pudo crear el seguimiento.")
    return {"status": "success", "seguimiento": seguimiento}

@app.post("/api/v1/seguimiento/{licitacion_id}/sli-snapshot")
def seguimiento_save_sli_snapshot(
    licitacion_id: int,
    req: SeguimientoSliSnapshotRequest,
    _token: str = Depends(verify_internal_token),
):
    serialized = json.dumps(req.snapshot or {}, ensure_ascii=False, default=str)
    if len(serialized) > 250_000:
        raise HTTPException(status_code=413, detail="La respuesta del SLI excede el tamaño permitido.")
    try:
        candidates = db.get_tracking_notification_candidates()
        if candidates is not None and not candidates.empty:
            matching_rows = [
                row for row in candidates.to_dict(orient="records")
                if int(row.get("seguimiento_id") or 0) == int(licitacion_id)
            ]
            if matching_rows:
                numero = "".join(filter(str.isdigit, str(matching_rows[0].get("numero_licitacion") or "")))
                related_rows = [
                    row for row in candidates.to_dict(orient="records")
                    if "".join(filter(str.isdigit, str(row.get("numero_licitacion") or ""))) == numero
                ]
                _apply_tracked_sli_result(numero, related_rows, req.snapshot or {}, persist=False, apply_status=False)
    except Exception as exc:
        logger.warning(f"[SEGUIMIENTO SLI] No se pudo evaluar cambio manual para {licitacion_id}: {exc}")
    saved = db.guardar_snapshot_sli(licitacion_id, req.snapshot)
    if not saved:
        raise HTTPException(status_code=404, detail="El seguimiento no existe.")
    return {"status": "success", **saved}

@app.get("/api/v1/seguimiento/{licitacion_id}/historial")
def seguimiento_historial(licitacion_id: int, _token: str = Depends(verify_internal_token)):
    df = db.get_historial_seguimiento(licitacion_id)
    return {"status": "success", "historial": _json_records(df)}

@app.post("/api/v1/seguimiento/{licitacion_id}/estado")
def seguimiento_update_estado(licitacion_id: int, req: SeguimientoEstadoRequest, _token: str = Depends(verify_internal_token)):
    db.actualizar_estado(licitacion_id, req.estado, req.nota, req.registrado_por or "Sistema")
    return {"status": "success"}

@app.delete("/api/v1/seguimiento/{licitacion_id}")
def seguimiento_delete(licitacion_id: int, _token: str = Depends(verify_internal_token)):
    db.eliminar_seguimiento(licitacion_id)
    return {"status": "success"}

@app.post("/api/v1/rfq-email/generate")
def rfq_email_generate(req: RfqEmailRequest, _token: str = Depends(verify_internal_token)):
    started_at = time.perf_counter()
    gemini_key = _resolve_gemini_key(req.username, req.gemini_key)
    if not gemini_key:
        raise HTTPException(status_code=400, detail="Configura Gemini API Key para generar el correo RFQ.")
    cg = req.cg or {}
    items_ctx = _items_context_text(req.items)
    lead_time = req.lead_time or str(cg.get("tiempo_de_entrega_global", "N/A"))
    prompt = f"""You are a professional procurement specialist writing a formal Request for Quotation (RFQ).

LANGUAGE: Write the entire RFQ in {req.language}.
STYLE: Polished, concise, human and supplier-friendly. Make it easy to copy/paste into Outlook. Use short paragraphs and avoid repetition.
STRICT RULE: Use only the provided bid and item context. Do not invent technical requirements, brands, quantities, standards, delivery terms, warranties or certifications.
OUTPUT RULE: Generate only the narrative email body. The frontend will append the supplier-confirmation table and the selected line-item table. Do not create tables and do not repeat the full item list.

ACP BID CONTEXT:
- Bid Number: {cg.get('numero_licitacion','N/A')}
- Delivery Location: {cg.get('lugar_de_entrega','N/A')}
- Global Lead Time Required: {lead_time}
- Offer Validity Required by ACP: {cg.get('validez_de_la_oferta','N/A')}
- Warranty Required: {cg.get('garantia_exigida','N/A')}
- Technical Proposal Required: {cg.get('propuesta_tecnica_requerida','N/A')}

SUPPLIER RECIPIENT:
- Contact name: {req.contact_name or 'Not specified'}
- Supplier company: {req.company or 'Not specified'}


ITEMS TO QUOTE:
{items_ctx}

INSTRUCTIONS:
Generate only the email body, no subject line. Make it ready to paste into Outlook.

Start with "Dear {req.contact_name}," when a contact name is provided. Otherwise start with "Dear Supplier,". Do not print a GREETING header and do not treat the supplier company or contact as the sender.

Write 3 concise parts without visible section headings:
1. State that we are preparing a quotation for ACP bid {cg.get('numero_licitacion','N/A')}, ask for the supplier's best technical and commercial offer, and mention the reply deadline when provided: {req.reply_by or 'Not specified'}.
2. Ask the supplier to complete the confirmation and line-item tables shown below the message. Emphasize best price, stock, payment terms {req.payment_terms}, and whether they can meet the ACP lead time {lead_time}. Mention alternatives only when technically equivalent or superior and fully documented.
3. Close with one short professional line such as "Best regards,". Do not include sender name, position, phone number, company name or signature block because the Outlook digital signature will be inserted automatically.

Keep it concise, polished and human. Use no Markdown code fences and no decorative symbols."""
    try:
        response = gemini_generate_content(gemini_key, prompt)
        body = response.text
        subject = f"[ACP-{cg.get('numero_licitacion','')}] Request for Quotation - {req.scope_label}"
        db.log_ai_usage(
            username=req.username,
            role="",
            action="rfq_email_generate",
            licitacion=str(cg.get("numero_licitacion", "")),
            model=GEMINI_MODEL,
            usage_metadata=response.usage_metadata,
            metadata={"items": len(req.items), "language": req.language},
        )
        return {"status": "success", "subject": subject, "body": body}
    except Exception as exc:
        detail = user_friendly_external_error(exc, context="Gemini")
        db.log_usage_event(
            username=req.username,
            module="rfq_email",
            action="generate",
            licitacion=str(cg.get("numero_licitacion", "")),
            provider="gemini",
            model=GEMINI_MODEL,
            status="error",
            error_message=detail[:500],
            duration_ms=int((time.perf_counter() - started_at) * 1000),
        )
        raise HTTPException(status_code=503, detail=detail)

@app.post("/api/v1/ai/advisor")
def ai_advisor(req: AiAdvisorRequest, _token: str = Depends(verify_internal_token)):
    gemini_key = _resolve_gemini_key(req.username, req.gemini_key)
    if not gemini_key:
        raise HTTPException(status_code=400, detail="Configura Gemini API Key para usar el asesor AI.")
    cg = req.cg or {}
    ref_price = f"USD {req.reference_price:,.2f}" if req.reference_price and req.reference_price > 0 else "No proporcionado"
    prompt = f"""Eres Carlos Mendez, Asesor Senior de Procura con 25 anos de experiencia en licitaciones ACP, procura industrial B2B y negociaciones internacionales.

Responde en espanol, directo, practico y con criterio profesional.
Regla estricta: usa solo el contexto de la licitacion, los renglones y la situacion aportada. Si falta un dato, escribe "No especificado en el contexto disponible". No inventes normas, marcas, precios ni condiciones.

CONTEXTO LICITACION:
- Numero: {cg.get('numero_licitacion','N/A')}
- Tiempo entrega: {cg.get('tiempo_de_entrega_global','N/A')}
- Garantia: {cg.get('garantia_exigida','N/A')}
- Lugar entrega: {cg.get('lugar_de_entrega','N/A')}
- Validez oferta: {cg.get('validez_de_la_oferta','N/A')}

RENGLONES:
{_items_context_text(req.items, limit_per_item=220)}

PRECIO REFERENCIA: {ref_price}
TIPO ANALISIS: {req.mode}

SITUACION / CORREO / PROBLEMA:
{req.situation[:2000]}

Devuelve una respuesta ejecutiva en Markdown con este formato exacto:

## Decision recomendada
- Participar / pedir aclaracion / negociar / no avanzar: elige una y explica en 2-3 lineas.

## Lectura rapida
- Resume la situacion y como impacta precio, cumplimiento tecnico, entrega y riesgo comercial.

## Riesgos y requisitos criticos
- Lista solo riesgos evidenciados en el contexto. Marca cada punto como Alto, Medio o Bajo.

## Acciones siguientes
- Checklist operativo con pasos concretos para analista/supervisor.

## Tacticas de negociacion
- Argumentos para buscar menor precio, mejor lead time, Net 30 o mejores terminos sin comprometer cumplimiento.

## Borrador profesional
- Texto listo para enviar o adaptar al proveedor/cliente.

## Dato faltante mas importante
- Indica el dato que mas limita la decision."""
    try:
        response = gemini_generate_content(gemini_key, prompt)
        db.log_ai_usage(username=req.username, action="ai_advisor", licitacion=str(cg.get("numero_licitacion", "")), model=GEMINI_MODEL, usage_metadata=response.usage_metadata)
        return {"status": "success", "answer": response.text}
    except Exception as exc:
        raise HTTPException(status_code=503, detail=user_friendly_external_error(exc, context="Gemini"))

@app.post("/api/v1/ai/copilot")
def ai_copilot(req: AiCopilotRequest, _token: str = Depends(verify_internal_token)):
    gemini_key = _resolve_gemini_key(req.username, req.gemini_key)
    if not gemini_key:
        raise HTTPException(status_code=400, detail="Configura Gemini API Key para usar Procura Copilot.")
    cg = req.cg or {}
    history_text = "\n".join([f"{m.get('role','').upper()}: {m.get('content','')}" for m in req.history[-8:]])
    prompt = f"""Eres Procura Copilot, asistente experto en procura industrial para Proyelec.
Responde en espanol de forma concisa y util. Si un dato no esta en el contexto, dilo claramente.

CONTEXTO LICITACION:
- Numero: {cg.get('numero_licitacion','N/A')}
- Tiempo entrega: {cg.get('tiempo_de_entrega_global','N/A')}
- Garantia: {cg.get('garantia_exigida','N/A')}
- Lugar entrega: {cg.get('lugar_de_entrega','N/A')}
- Validez oferta: {cg.get('validez_de_la_oferta','N/A')}
- Propuesta tecnica: {cg.get('propuesta_tecnica_requerida','N/A')}

RENGLONES:
{_items_context_text(req.items, limit_per_item=220)}

HISTORIAL:
{history_text}

PREGUNTA:
{req.question}
"""
    try:
        response = gemini_generate_content(gemini_key, prompt)
        db.log_ai_usage(username=req.username, action="ai_copilot", licitacion=str(cg.get("numero_licitacion", "")), model=GEMINI_MODEL, usage_metadata=response.usage_metadata)
        return {"status": "success", "answer": response.text}
    except Exception as exc:
        raise HTTPException(status_code=503, detail=user_friendly_external_error(exc, context="Gemini"))

# =============================================
# CONSULTA AUTOMATICA AL SLI DE LA ACP
# =============================================

@app.get("/api/v1/consultar-sli/{rfq_id}")
def consultar_sli(rfq_id: str, _token: str = Depends(verify_internal_token)):
    started_at = time.perf_counter()
    rfq_id = "".join(filter(str.isdigit, str(rfq_id or "")))
    if not rfq_id:
        db.log_usage_event(module="sli", action="consultar_sli", status="error", error_message="Numero de licitacion invalido")
        raise HTTPException(
            status_code=400,
            detail={
                "message": "Numero de licitacion invalido.",
                "hint": "Ingresa solo el numero RFQ de la licitacion ACP."
            }
        )

    SLI_HOME_URL = "https://apps.pancanal.com/sli/LicitacionesBusqueda/Welcome"
    SLI_URL = f"https://apps.pancanal.com/sli/Licitaciones/LicitacionHeader?rfqId={rfq_id}"

    def extraer_resumen_acta(texto_acta, acta_url):
        texto_acta = re.sub(r"\s+", " ", texto_acta or "").strip()
        if not texto_acta:
            return {
                "disponible": False,
                "url": acta_url,
                "resumen": "",
                "hallazgos": [],
                "error": "El acta no contiene texto legible."
            }

        texto_normalizado = "".join(
            ch for ch in unicodedata.normalize("NFD", texto_acta.lower())
            if unicodedata.category(ch) != "Mn"
        )
        menciona_proyelec = "proyelec" in texto_normalizado
        menciona_ep = bool(re.search(r"\bep\s+international\b", texto_normalizado))
        adjudicacion = _extract_award_result(texto_acta)
        contextos_empresa = re.findall(
            r".{0,180}(?:proyelec|ep\s+international).{0,180}",
            texto_normalizado,
            flags=re.IGNORECASE,
        )
        contexto_empresa = " ".join(contextos_empresa)
        posible_adjudicacion = bool(adjudicacion.get("confirmada") and adjudicacion.get("es_propia"))
        if contexto_empresa and re.search(r"no\s+cumple|incumple|no\s+conforme|descalific", contexto_empresa):
            cumplimiento_tecnico = "no_cumple"
        elif contexto_empresa and re.search(r"\bcumple\b|\bconforme\b|cumplimiento\s+tecnico", contexto_empresa):
            cumplimiento_tecnico = "cumple"
        else:
            cumplimiento_tecnico = "indeterminado"

        palabras_clave = [
            "no cumple", "incumple", "fallo", "falla", "deficiencia",
            "observacion", "observación", "subsan", "tecnico", "técnico",
            "rechaz", "descalific", "no acept", "aclaracion", "aclaración"
        ]

        partes = re.split(r"(?<=[.!])\s+|\n+", texto_acta)
        hallazgos = []

        for parte in partes:
            parte_limpia = parte.strip()
            parte_lower = parte_limpia.lower()
            if len(parte_limpia) < 35:
                continue
            if any(palabra in parte_lower for palabra in palabras_clave):
                hallazgos.append(parte_limpia[:450])
            if len(hallazgos) >= 8:
                break

        if hallazgos:
            resumen = "Se detectaron posibles observaciones tecnicas o comentarios relevantes en el acta."
        elif any(palabra in texto_acta.lower() for palabra in ["cumple", "conforme", "adjudic"]):
            resumen = "No se detectaron fallos tecnicos evidentes en una lectura automatica del acta."
        else:
            resumen = "El acta fue encontrada, pero no se detectaron observaciones tecnicas claras automaticamente."

        return {
            "disponible": True,
            "url": acta_url,
            "resumen": resumen,
            "hallazgos": hallazgos,
            "texto_muestra": texto_acta[:1200],
            "menciona_proyelec": menciona_proyelec,
            "menciona_ep_international": menciona_ep,
            "posible_adjudicacion_propia": posible_adjudicacion,
            "adjudicacion": adjudicacion,
            "cumplimiento_tecnico": cumplimiento_tecnico,
            "error": None
        }

    try:
        from playwright.sync_api import (
            Error as PlaywrightError,
            TimeoutError as PlaywrightTimeoutError,
            sync_playwright,
        )
    except ImportError:
        raise HTTPException(
            status_code=503,
            detail={
                "message": "Playwright no esta instalado.",
                "hint": "Ejecuta: pip install playwright && playwright install chromium"
            }
        )

    browser = None
    resumen_acta = {
        "disponible": False,
        "url": None,
        "resumen": "",
        "hallazgos": [],
        "error": "No se encontro el boton de resumen de propuestas recibidas."
    }

    try:
        with sync_playwright() as p:
            try:
                browser = p.chromium.launch(
                    headless=True,
                    args=[
                        "--no-sandbox",
                        "--disable-dev-shm-usage",
                        "--disable-blink-features=AutomationControlled"
                    ]
                )
            except PlaywrightError as e:
                msg = str(e)
                if "Executable doesn't exist" in msg or "playwright install" in msg:
                    raise HTTPException(
                        status_code=503,
                        detail={
                            "message": "Chromium de Playwright no esta instalado.",
                            "hint": "Ejecuta: playwright install chromium"
                        }
                    )
                raise

            page = browser.new_page()
            page.set_default_timeout(15000)
            page.set_extra_http_headers({
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124"
            })

            response = page.goto(SLI_HOME_URL, wait_until="domcontentloaded", timeout=30000)
            if response and response.status >= 500:
                raise HTTPException(
                    status_code=502,
                    detail={
                        "message": f"El SLI respondio con HTTP {response.status}.",
                        "hint": "El portal de ACP puede estar caido o inestable. Intenta de nuevo mas tarde."
                    }
                )

            page.wait_for_selector("#rfqId", timeout=15000)
            page.fill("#rfqId", rfq_id)

            if page.locator("#hfEstatusSeleccionadoID").count() > 0:
                page.evaluate(
                    'document.getElementById("hfEstatusSeleccionadoID").value = "TODOS";'
                )

            page.click("input[type='submit']")

            try:
                page.wait_for_function(
                    "() => document.body.innerText.includes('Detalle de RFQ') || "
                    "document.body.innerText.includes('EVALUACI') || "
                    "document.body.innerText.includes('No se encontraron') || "
                    "document.body.innerText.includes('InternalServer')",
                    timeout=20000
                )
            except PlaywrightTimeoutError:
                logger.warning(f"Timeout esperando resultados del SLI para RFQ {rfq_id}")

            content = page.content()
            current_sli_url = page.url

            resumen_visible = page.locator(".ResPropRec").count() > 0
            po_header_match = re.search(r"po_header\s*[=:]\s*['\"](\d+)", content, re.IGNORECASE)
            if not po_header_match:
                po_header_match = re.search(r"po_header=(\d+)", content, re.IGNORECASE)

            if resumen_visible and po_header_match:
                po_header = po_header_match.group(1)
                acta_url = urljoin(
                    current_sli_url,
                    f"../Comunes/ImpresionActaResumenp_rfq={rfq_id}&po_header={po_header}"
                )

                try:
                    acta_response = page.request.get(
                        acta_url,
                        headers={"Referer": current_sli_url},
                        timeout=30000
                    )
                    acta_bytes = acta_response.body()
                    content_type = (acta_response.headers.get("content-type") or "").lower()

                    if "pdf" in content_type or acta_bytes[:4] == b"%PDF":
                        try:
                            from pypdf import PdfReader

                            reader = PdfReader(io.BytesIO(acta_bytes))
                            texto_acta = "\n".join(
                                page_pdf.extract_text() or ""
                                for page_pdf in reader.pages
                            )
                            resumen_acta = extraer_resumen_acta(texto_acta, acta_url)
                        except ImportError:
                            resumen_acta = {
                                "disponible": False,
                                "url": acta_url,
                                "resumen": "",
                                "hallazgos": [],
                                "error": "pypdf no esta instalado para leer el PDF del resumen."
                            }
                    else:
                        html_acta = acta_bytes.decode("utf-8", errors="ignore")
                        texto_acta = BeautifulSoup(html_acta, "html.parser").get_text(
                            separator=" ",
                            strip=True
                        )
                        resumen_acta = extraer_resumen_acta(texto_acta, acta_url)

                except Exception as e:
                    logger.warning(f"No se pudo leer acta resumen SLI {rfq_id}: {e}")
                    resumen_acta = {
                        "disponible": False,
                        "url": acta_url,
                        "resumen": "",
                        "hallazgos": [],
                        "error": "Se encontro el resumen, pero no se pudo leer automaticamente."
                    }

    except HTTPException:
        raise
    except PlaywrightTimeoutError as e:
        logger.warning(f"Timeout consultando SLI {rfq_id}: {e}")
        raise HTTPException(
            status_code=504,
            detail={
                "message": "El SLI tardo demasiado en responder.",
                "hint": "Verifica la conexion o intenta nuevamente en unos minutos."
            }
        )
    except PlaywrightError as e:
        logger.exception(f"Error de Playwright consultando SLI {rfq_id}")
        raise HTTPException(
            status_code=502,
            detail={
                "message": "No se pudo consultar el portal SLI.",
                "hint": "El portal pudo cambiar, bloquear la automatizacion o estar temporalmente fuera de servicio.",
                "technical": str(e)[:500]
            }
        )
    except Exception as e:
        logger.exception(f"Error inesperado consultando SLI {rfq_id}")
        raise HTTPException(
            status_code=500,
            detail={
                "message": "Error inesperado consultando el SLI.",
                "hint": "Revisa backend.log para ver el traceback completo.",
                "technical": str(e)[:500]
            }
        )
    finally:
        if browser:
            try:
                browser.close()
            except Exception:
                pass

    try:

        soup_sli = BeautifulSoup(content, "html.parser")

        texto_sli = soup_sli.get_text(separator="|", strip=True)
        codigos_acp_detectados = _extract_acp_codes_from_text(texto_sli)
        renglones_detectados = _extract_sli_visible_items(texto_sli)

        tokens = [t.strip() for t in texto_sli.split("|") if t.strip()]

        def buscar_valor(etiquetas):

            for i, tok in enumerate(tokens):

                for etiq in etiquetas:

                    if (
                        tok.strip().lower() == etiq.lower()
                        or tok.strip().lower() == f"{etiq.lower()}:"
                    ):

                        for j in range(i + 1, min(i + 4, len(tokens))):

                            cand = tokens[j]

                            if (
                                cand
                                and not any(
                                    e.lower() == cand.strip().lower()
                                    for e in etiquetas
                                )
                                and len(cand) > 2
                            ):
                                return cand

            return None

        resultado = {
            "rfq_id": rfq_id,
            "url": SLI_URL,
            "estatus": buscar_valor(["Estatus", "Estado"]),
            "descripcion": buscar_valor(["Descripción", "Descripcion"]),
            "fecha_cierre": buscar_valor([
                "Fecha y hora de cierre",
                "Fecha de cierre",
                "Cierre"
            ]),
            "fecha_publicacion": buscar_valor([
                "Fecha de publicación",
                "Publicación",
                "Publicacion"
            ]),
            "ultima_revision": buscar_valor([
                "Última revisión",
                "Ultima Revision",
                "Última Revisión"
            ]),
            "numero_enmienda": buscar_valor([
                "# Enmienda",
                "Numero de Enmienda",
                "Enmienda"
            ]),
            "agente_compras": buscar_valor([
                "Agente de compras",
                "Agente Compras",
                "Purchasing Agent"
            ]),
            "codigos_acp_detectados": codigos_acp_detectados,
            "renglones_detectados": renglones_detectados,
            "renglones_detectados_count": len(renglones_detectados),
            "requiere_revision_rfq": len(codigos_acp_detectados) == 0 and len(renglones_detectados) == 0,
            "nota_revision_rfq": (
                "No se detectaron códigos ACP ni renglones claros en el detalle visible del SLI. Para comparar por producto hay que revisar el RFQ/pliego."
                if not codigos_acp_detectados and not renglones_detectados
                else "Se detectaron códigos ACP/renglones visibles en el detalle SLI."
            ),
            "resumen_acta": resumen_acta,
            "error": None
        }

        ESTADOS_SLI = [
            "EVALUACIÓN",
            "EVALUACION",
            "ADJUDICACIÓN",
            "ADJUDICACION",
            "CANCELACIÓN",
            "CANCELACION",
            "ACTO DESIERTO",
            "DESIERTA",
            "ENMENDADA",
            "ANUNCIO VENCIDO",
            "ABIERTA",
            "PRECALIFICACIÓN"
        ]

        if not resultado["estatus"]:

            texto_upper = texto_sli.upper()

            for estado in ESTADOS_SLI:

                if estado in texto_upper:
                    resultado["estatus"] = estado.title()
                    break

        if not resultado["estatus"] and not resultado["descripcion"]:

            resultado["error"] = (
                "No se encontró información. "
                "Verifica el número de licitación o intenta más tarde."
            )

        estado_acp = _normalize_sli_status(resultado.get("estatus"))
        adjudicacion = (resultado.get("resumen_acta") or {}).get("adjudicacion") or _extract_award_result("")
        resultado["estado_acp"] = estado_acp
        resultado["adjudicacion"] = adjudicacion

        logger.info(
            f"Consulta SLI {rfq_id}: "
            f"estatus={resultado['estatus']} | "
            f"desc={resultado['descripcion']}"
        )
        db.log_usage_event(
            module="sli",
            action="consultar_sli",
            licitacion=rfq_id,
            status="error" if resultado.get("error") else "success",
            error_message=resultado.get("error") or "",
            duration_ms=int((time.perf_counter() - started_at) * 1000),
            metadata={
                "estatus": resultado.get("estatus"),
                "estado_acp": estado_acp.get("code"),
                "descripcion_detectada": bool(resultado.get("descripcion")),
                "acta_disponible": bool((resultado.get("resumen_acta") or {}).get("disponible")),
                "adjudicacion_confirmada": bool(adjudicacion.get("confirmada")),
                "codigos_acp_detectados": len(codigos_acp_detectados),
                "renglones_detectados": len(renglones_detectados)
            }
        )

        return resultado
    except Exception as e:
        logger.exception(f"Error parseando respuesta SLI {rfq_id}")
        db.log_usage_event(
            module="sli",
            action="consultar_sli",
            licitacion=rfq_id,
            status="error",
            error_message=str(e)[:500],
            duration_ms=int((time.perf_counter() - started_at) * 1000)
        )
        raise HTTPException(
            status_code=500,
            detail={
                "message": "El SLI respondio, pero no se pudo interpretar la pagina.",
                "hint": "Puede haber cambiado el formato del portal ACP.",
                "technical": str(e)[:500]
            }
        )









