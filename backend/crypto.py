import os
import logging
from cryptography.fernet import Fernet, InvalidToken
from dotenv import load_dotenv

load_dotenv()
logger = logging.getLogger(__name__)

# Inicialización segura de la clave Fernet compartida
_enc_key_str = os.getenv("ENCRYPTION_KEY", "").strip()

# Si no hay clave, NO generamos una nueva automáticamente en producción.
# En producción, la clave debe venir de la variable de entorno.
# Si generamos una nueva, los datos cifrados previamente quedarán inaccesibles.
if not _enc_key_str:
    logger.error("ENCRYPTION_KEY no está configurada. Los datos cifrados no podrán descifrase.")
    logger.error("En local, asegurate de tener ENCRYPTION_KEY en el .env.")
    logger.error("En Railway, agregá la variable ENCRYPTION_KEY en el servicio backend.")
    # En desarrollo local, podríamos generar una, pero en producción no.
    if os.getenv("RAILWAY_ENVIRONMENT") or os.getenv("RAZZUIL_ENVIRONMENT"):
        raise RuntimeError("ENCRYPTION_KEY requerida en producción pero no está configurada.")
    # Solo en local, generamos una temporal con advertencia
    _enc_key_str = Fernet.generate_key().decode()
    logger.warning(f"Generada ENCRYPTION_KEY temporal para desarrollo local: {_enc_key_str[:20]}...")
    # Intentamos escribirla en .env local (solo si tenemos permisos)
    try:
        env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
        with open(env_path, "a") as f:
            f.write(f"\nENCRYPTION_KEY={_enc_key_str}\n")
        logger.info(f"ENCRYPTION_KEY escrita en {env_path}")
    except Exception as e:
        logger.warning(f"No se pudo escribir en .env: {e}")

# Extraer solo la llave si el usuario pegó "ENCRYPTION_KEY=..." por error
if _enc_key_str.startswith("ENCRYPTION_KEY="):
    _enc_key_str = _enc_key_str.split("=", 1)[1].strip()

try:
    ENCRYPTION_KEY = _enc_key_str.encode()
    cipher_suite = Fernet(ENCRYPTION_KEY)
    # Probamos una operación básica para validar la clave
    test_payload = cipher_suite.encrypt(b"test")
    cipher_suite.decrypt(test_payload)
    logger.info("clave Fernet inicializada correctamente")
except Exception as e:
    logger.error(f"clave Fernet invalida: {e}")
    logger.error("La clave de cifrado no es válida. Los datos cifrados no podrán leerse.")
    if os.getenv("RAILWAY_ENVIRONMENT") or os.getenv("RAZZUIL_ENVIRONMENT"):
        raise RuntimeError(f"ENCRYPTION_KEY invalida en producción: {e}")
    # En local, generamos una nueva
    cipher_suite = Fernet(Fernet.generate_key())
    logger.warning("Usando clave Fernet temporal de reemplazo para desarrollo local.")

def encrypt_data(text: str) -> str:
    """Cifra un texto plano utilizando la clave maestra."""
    if not text:
        return ""
    try:
        return cipher_suite.encrypt(text.encode()).decode()
    except Exception as e:
        logger.error(f"Error al cifrar datos: {e}")
        return ""

def decrypt_data(text: str) -> str:
    """Descifra un texto cifrado utilizando la clave maestra.
    
    En producción (Railway), si la clave es incorrecta, falla explícitamente.
    En desarrollo local, devuelve cadena vacía para permitir desarrollo.
    """
    if not text:
        return ""
    try:
        return cipher_suite.decrypt(text.encode()).decode()
    except (InvalidToken, Exception) as e:
        error_msg = f"Error al descifrar datos: {str(e)[:200]}"
        # En producción, fallamos explícitamente para notificar el problema
        if os.getenv("RAILWAY_ENVIRONMENT") or os.getenv("RAZZUIL_ENVIRONMENT"):
            logger.error(error_msg)
            logger.error("La clave de cifrado en Railway no coincide con los datos cifrados.")
            logger.error("Verificá que ENCRYPTION_KEY en Railway sea igual al valor usado al cifrar los datos.")
            raise RuntimeError(f"Clave de cifrado invalida en producción: {e}")
        # En desarrollo local, logueamos pero devolvemos vacío
        logger.warning(error_msg)
        return ""
