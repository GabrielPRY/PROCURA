# Variables de entorno para Railway

## Backend service

Root directory: `backend`

Puerto manual recomendado en Railway: `8080`

Pega estas variables en Railway > backend > Variables:

```env
DATABASE_URL=PEGAR_VALOR_REAL_DE_C:\Users\Grodriguez\Desktop\PROCURA_TEST\.env
ENCRYPTION_KEY=PEGAR_VALOR_REAL_DE_C:\Users\Grodriguez\Desktop\PROCURA_TEST\.env
INTERNAL_API_TOKEN=CREAR_UN_TOKEN_LARGO_Y_USAR_EL_MISMO_EN_FRONTEND
FRONTEND_ORIGIN=https://procurapry.up.railway.app
GEMINI_MODEL=gemini-2.5-flash
GEMINI_FALLBACK_MODELS=gemini-2.5-flash-lite
RADAR_AUTO_SCAN_ENABLED=true
RADAR_AUTO_SCAN_INTERVAL_MINUTES=25
RADAR_AUTO_SCAN_ON_STARTUP=false
BRAVE_SEARCH_API_KEY=
```

Notas:

- `DATABASE_URL` y `ENCRYPTION_KEY` ya existen en `C:\Users\Grodriguez\Desktop\PROCURA_TEST\.env`.
- `ENCRYPTION_KEY` debe ser exactamente la misma para que Railway pueda descifrar llaves/API keys ya guardadas en la base.
- `FRONTEND_ORIGIN` se completa despues de desplegar el frontend y generar su dominio publico.
- `BRAVE_SEARCH_API_KEY` puede quedar vacio por ahora.

## Frontend service

Root directory: `frontend`

Pega estas variables en Railway > frontend > Variables:

```env
NEXT_PUBLIC_API_BASE_URL=https://procura-production-a50e.up.railway.app/api/v1
NEXT_PUBLIC_INTERNAL_API_TOKEN=EL_MISMO_VALOR_DE_INTERNAL_API_TOKEN_DEL_BACKEND
NIXPACKS_NODE_VERSION=20
```

Notas:

- `NEXT_PUBLIC_API_BASE_URL` debe terminar en `/api/v1`.
- `NEXT_PUBLIC_INTERNAL_API_TOKEN` debe coincidir con `INTERNAL_API_TOKEN`.
- Como empieza con `NEXT_PUBLIC`, el token queda visible para el navegador. Para beta interna sirve como control basico, pero no debe considerarse seguridad fuerte.
