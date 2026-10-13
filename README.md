# Core IA — FastAPI + Gemini + Discord OAuth2

Plataforma de chat con IA de nivel enterprise: backend **FastAPI** conectado a **Google Gemini**, autenticación **Discord OAuth2** con sesiones firmadas (`itsdangerous`) y frontend estático estilo ChatGPT/Gemini.

## Estructura

```
CoreIA/
├── backend/
│   ├── main.py            # API FastAPI (auth Discord + chat Gemini)
│   ├── requirements.txt   # Dependencias
│   ├── Procfile           # Comando de arranque (Render/Railway)
│   ├── .env               # Variables locales (NO se sube a git)
│   └── .gitignore
├── index.html             # Frontend Core IA (modo oscuro, sidebar)
├── script.js              # Lógica de sesión y chat
└── render.yaml            # Blueprint de despliegue en Render
```

## 1. Crear la app en Discord

1. Entra en https://discord.com/developers/applications → **New Application**.
2. Pestaña **OAuth2**:
   - Copia **Client ID** y **Client Secret** (botón *Reset Secret*).
   - En **Redirects**, añade exactamente:
     `https://TU-BACKEND.onrender.com/api/auth/discord/callback`
3. Guarda los cambios.

## 2. Variables de entorno

Copia `backend/.env.example` a `backend/.env` y rellena:

```
AI_API_KEY=...            # https://aistudio.google.com/apikey
AI_MODEL=gemini-3.8-flash
AI_MODEL_FALLBACKS=gemini-3.5-flash,gemini-3.5-flash-lite,gemini-3.7-flash,gemini-flash-latest
AI_RETRIES=2
SESSION_SECRET=...        # cadena aleatoria larga
DISCORD_CLIENT_ID=...
DISCORD_CLIENT_SECRET=...
DISCORD_REDIRECT_URI=https://TU-BACKEND.onrender.com/api/auth/discord/callback
FRONTEND_URL=https://TU-FRONTEND
ALLOWED_ORIGINS=https://TU-FRONTEND,http://localhost:5500
```

## 3. Local

```bash
cd backend
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload
```

Backend en `http://127.0.0.1:8000`. Sirve el frontend con un servidor estático
(por ejemplo `npx serve` en la raíz) y ajusta `BACKEND_URL` en `script.js`.

## 4. Despliegue en Render

1. Sube el repo a GitHub.
2. Render → **New → Blueprint** → conecta el repo (lee `render.yaml`).
3. Define las variables marcadas como secretas (AI_API_KEY, SESSION_SECRET, DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET).
4. Al terminar, copia la URL pública y verifica que coincida con `DISCORD_REDIRECT_URI` y `BACKEND_URL`.

## Endpoints

| Método | Ruta                          | Descripción                              |
| ------ | ----------------------------- | ---------------------------------------- |
| GET    | `/api/auth/discord/login`     | Redirige a Discord OAuth2                |
| GET    | `/api/auth/discord/callback`  | Intercambia el código y crea la sesión   |
| GET    | `/api/auth/me`                | Perfil del usuario autenticado           |
| POST   | `/api/auth/logout`            | Cierra la sesión                         |
| POST   | `/api/chat`                   | Chat con Gemini (requiere Bearer token)  |

## Seguridad

- CORS restringido a los orígenes de `ALLOWED_ORIGINS`.
- Token de sesión firmado con `SESSION_SECRET` (itsdangerous, con expiración).
- El `access_token` de Discord nunca se expone al cliente.
- La `state` de OAuth está firmada y expira en 10 minutos.
