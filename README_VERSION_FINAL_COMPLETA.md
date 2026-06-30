# Procura AI - Version Final Completa para GitHub

Carpeta lista para subir a GitHub y desplegar en Railway.

Incluye:
- Frontend Next actualizado.
- Backend FastAPI actualizado.
- Mejoras UX/UI recientes.
- Correo RFQ premium sin firma manual, pensado para firma digital de Outlook.
- Calculadora logistica con panel de valores administrables para Logistica/Admin.
- Endpoints backend protegidos para tarifas internacionales, forwarders/localidades y tarifas locales.
- Radar, seguimiento, RFQ, proveedores, costos, historico, auditor IA, evaluacion y workspaces segun estado actual del proyecto.

No incluye:
- node_modules
- .next
- .env / .env.local
- logs locales
- caches Python
- archivos temporales de build

Antes de desplegar:
- Revisar variables de entorno en Railway.
- Backend debe usar puerto 8080 si Railway lo pide manualmente.
- Frontend debe apuntar a NEXT_PUBLIC_API_BASE_URL del backend con /api/v1 o la URL base normalizada.
