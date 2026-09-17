import os
import logging
from cryptography.fernet import Fernet
from dotenv import load_dotenv

load_dotenv()
logger = logging.getLogger(__name__)

# Inicialización segura de la clave Fernet compartida
_enc_key_str = os.getenv("ENCRYPTION_KEY", "").strip()

if not _enc_key_str:
    _enc_key_str = Fernet.generate_key().decode()
    try:
        with open(".env", "a") as f:
            f.write(f"\nENCRYPTION_KEY={_enc_key_str}\n")
    except Exception as e:
        logger.warning(f"No se pudo escribir en .env: {e}")
    os.environ["ENCRYPTION_KEY"] = _enc_key_str
    logger.warning("ENCRYPTION_KEY no encontrada — se generó una nueva.")

# Extraer solo la llave si el usuario pegó "ENCRYPTION_KEY=..." por error
if _enc_key_str.startswith("ENCRYPTION_KEY="):
    _enc_key_str = _enc_key_str.split("=", 1)[1].strip()

try:
    ENCRYPTION_KEY = _enc_key_str.encode()
    cipher_suite = Fernet(ENCRYPTION_KEY)
except Exception as e:
    logger.error(f"Error inicializando Fernet con la clave proporcionada: {e}")
    # Fallback seguro en caso de clave inválida (evita que la app crashee, pero las contraseñas fallarán)
    cipher_suite = Fernet(Fernet.generate_key())

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
    """Descifra un texto cifrado utilizando la clave maestra."""
    if not text: 
        return ""
    try:
        return cipher_suite.decrypt(text.encode()).decode()
    except Exception as e:
        logger.error(f"Error al descifrar datos: {e}")
        return ""
