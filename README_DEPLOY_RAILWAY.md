# Procura AI - Railway Deploy

Esta carpeta esta lista para subir a GitHub y desplegar en Railway como dos servicios:

1. `backend` - FastAPI
2. `frontend` - Next.js

No contiene `.env`, logs, `node_modules`, `.next` ni archivos Excel locales.

## Orden de deploy

1. Sube esta carpeta completa a un repositorio nuevo en GitHub.
2. En Railway, crea un proyecto nuevo.
3. Crea un servicio desde GitHub usando root directory `backend`.
4. **Antes de desplegar**, configura las variables CRÍTICAS del backend:

   **Variables obligatorias (sin estas el backend no funciona):**
   - `DATABASE_URL` - URL completa de tu BD Postgres (ej: Supabase)
   - `ENCRYPTION_KEY` - **DEBE SER EXACTAMENTE EL MISMIMO VALOR** que está en tu `.env` local donde se cifraron los datos. Si no coincide, las API keys de los usuarios no pueden descifrase.
   - `INTERNAL_API_TOKEN` - Un token largo y secreto (mínimo 32 caracteres). Debe ser el mismo que usas en el frontend.
   - `FRONTEND_ORIGIN` - URL del frontend (ej: `https://procurapry.up.railway.app`) - sin esto el CORS bloquea el frontend.
   - `GEMINI_MODEL=gemini-2.5-flash` - Modelo de Gemini a usar.

   **Variables opcionales:**
   - `GEMINI_FALLBACK_MODELS=gemini-2.5-flash-lite`
   - `RADAR_AUTO_SCAN_ENABLED=true` - Activa el escaneo automático del SLI
   - `RADAR_AUTO_SCAN_INTERVAL_MINUTES=25` - Intervalo entre escaneos
   - `TELEGRAM_*` - Variables para notificaciones por Telegram
   - `SHIPSTATION_*` - Variables para comparación de tarifas de envío
   - `UPS_*` y `SCHNEIDER_*` - Variables para APIs de logística

## Comandos esperados

Backend:

```bash
uvicorn api:app --host 0.0.0.0 --port $PORT
```

Frontend:

```bash
npm run start -- -p $PORT
```

## Pruebas minimas

- Login.
- Admin > API global.
- RFQ con PDF pequeno.
- Radar SLI.
- Proveedores.
- Logistica.

