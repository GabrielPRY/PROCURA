# Procura AI - Railway Deploy

Esta carpeta esta lista para subir a GitHub y desplegar en Railway como dos servicios:

1. `backend` - FastAPI
2. `frontend` - Next.js

No contiene `.env`, logs, `node_modules`, `.next` ni archivos Excel locales.

## Orden de deploy

1. Sube esta carpeta completa a un repositorio nuevo en GitHub.
2. En Railway, crea un proyecto nuevo.
3. Crea un servicio desde GitHub usando root directory `backend`.
4. Configura las variables del backend usando `backend/.env.example`.
5. Despliega backend y copia su URL publica.
6. Crea otro servicio desde el mismo repo usando root directory `frontend`.
7. Configura `NEXT_PUBLIC_API_BASE_URL` con la URL del backend terminando en `/api/v1`.
8. Configura `NEXT_PUBLIC_INTERNAL_API_TOKEN` con el mismo token del backend.
9. Despliega frontend.
10. Vuelve al backend y configura `FRONTEND_ORIGIN` con la URL publica del frontend.
11. Redeploy backend.

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

