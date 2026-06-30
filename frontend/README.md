# Procura Frontend Dev

Frontend experimental para Procura AI.

Esta carpeta esta separada de produccion:

- Produccion Streamlit: `C:\Users\Grodriguez\Desktop\PROCURA`
- Desarrollo Streamlit/API: `C:\Users\Grodriguez\Desktop\PROCURA_TEST`
- Frontend nuevo: `C:\Users\Grodriguez\Desktop\PROCURA_FRONTEND_DEV`

Objetivo:

1. Construir un frontend moderno sin romper Streamlit.
2. Usar FastAPI como backend oficial.
3. Migrar modulos uno por uno.

Primer modulo recomendado:

- Radar Supervisor

Comandos con Node instalado normalmente:

```powershell
cd C:\Users\Grodriguez\Desktop\PROCURA_FRONTEND_DEV
copy .env.example .env.local
npm install
npm run dev
```

Comandos con el Node portatil creado en esta carpeta:

```powershell
cd C:\Users\Grodriguez\Desktop\PROCURA_FRONTEND_DEV
$env:PATH="C:\Users\Grodriguez\Desktop\PROCURA_FRONTEND_DEV\.tools\node;" + $env:PATH
.\.tools\node\npm.cmd run dev
```

El backend esperado es FastAPI en `http://127.0.0.1:8000/api/v1`.
