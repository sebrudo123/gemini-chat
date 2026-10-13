# Core IA — FastAPI + Gemini + Discord OAuth2

Plataforma de chat con IA de nivel enterprise: backend **FastAPI** conectado a **Google Gemini**, autenticación **Discord OAuth2** con sesiones firmadas (`itsdangerous`) y frontend estático estilo ChatGPT/Gemini.

## Estructura

```
CoreIA/
├── backend/
│   ├── main.py             # API FastAPI (auth Discord + chat Gemini)
│   ├── config.py           # Configuración central (settings)
│   ├── database.py         # Motor y sesiones SQLAlchemy
│   ├── models.py           # User, Conversation, Message, Document, DocumentChunk
│   ├── tools.py            # Herramientas (function calling): hora, cálculo
│   ├── rag.py              # RAG: chunking, embeddings y búsqueda semántica
│   ├── cache.py            # Caché opcional con Redis
│   ├── requirements.txt    # Dependencias de producción
│   ├── requirements-dev.txt# Dependencias de desarrollo/pruebas
│   ├── Dockerfile          # Imagen de producción
│   ├── docker-compose.yml  # API + Postgres + Redis en local
│   ├── pytest.ini          # Config de pruebas
│   ├── tests/              # Pruebas (pytest)
│   ├── Procfile            # Comando de arranque (Render/Railway)
│   ├── .env.example        # Plantilla de variables
│   └── .gitignore
├── .github/workflows/ci.yml# CI: lint + tests
├── index.html              # Frontend Core IA (modo oscuro, sidebar)
├── script.js               # Lógica de sesión y chat
├── vercel.json             # Config de despliegue en Vercel
└── render.yaml             # Blueprint de despliegue en Render
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
IMAGE_MODEL=              # vacío deshabilita la generación de imágenes (modelo de pago)
EMBEDDING_MODEL=gemini-embedding-001
RAG_ENABLED=true
RAG_TOP_K=4
SESSION_SECRET=...        # cadena aleatoria larga
DISCORD_CLIENT_ID=...
DISCORD_CLIENT_SECRET=...
DISCORD_REDIRECT_URI=https://TU-BACKEND.onrender.com/api/auth/discord/callback
FRONTEND_URL=https://TU-FRONTEND
ALLOWED_ORIGINS=https://TU-FRONTEND,http://localhost:5500
DATABASE_URL=postgresql://usuario:password@host:5432/coreia   # opcional (si falta usa SQLite)
REDIS_URL=                # opcional (caché + rate limiting distribuido)
SENTRY_DSN=               # opcional (observabilidad)
ENVIRONMENT=production
RATE_LIMIT=30/minute
```

## 3. Local

Con Python:

```bash
cd backend
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload
```

O con Docker (levanta API + Postgres + Redis):

```bash
cd backend
docker compose up --build
```

Backend en `http://127.0.0.1:8000`. Sirve el frontend con un servidor estático
(por ejemplo `npx serve` en la raíz) y ajusta `BACKEND_URL` en `script.js`.

## Pruebas y CI

```bash
cd backend
pip install -r requirements-dev.txt
pytest
```

El flujo **`.github/workflows/ci.yml`** ejecuta *lint* (errores reales) y las
pruebas en cada push y pull request.

## 4. Despliegue en Render

1. Sube el repo a GitHub.
2. Render → **New → Blueprint** → conecta el repo (lee `render.yaml`).
3. Define las variables marcadas como secretas (AI_API_KEY, SESSION_SECRET, DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET).
4. Al terminar, copia la URL pública y verifica que coincida con `DISCORD_REDIRECT_URI` y `BACKEND_URL`.

## Arquitectura e infraestructura

- **Persistencia**: PostgreSQL con SQLAlchemy 2.x (`DATABASE_URL`). Si no se
  define, cae a SQLite (solo desarrollo). Tablas: `users`, `conversations`,
  `messages`; se crean automáticamente al arrancar.
- **Caché / rate limiting**: `slowapi` limita `RATE_LIMIT` por usuario/IP. Si se
  define `REDIS_URL`, el límite es distribuido y `cache.py` habilita caché.
- **Observabilidad**: si defines `SENTRY_DSN`, se inicializa Sentry.
- **Docker**: `Dockerfile` (producción) y `docker-compose.yml` (API+Postgres+Redis).
- **CI**: lint + pytest en GitHub Actions.

## Endpoints

| Método | Ruta                          | Descripción                              |
| ------ | ----------------------------- | ---------------------------------------- |
| GET    | `/`                           | Estado del servicio (incluye caché)      |
| GET    | `/api/auth/discord/login`     | Redirige a Discord OAuth2                |
| GET    | `/api/auth/discord/callback`  | Intercambia el código y crea la sesión   |
| GET    | `/api/auth/me`                | Perfil del usuario autenticado           |
| POST   | `/api/auth/logout`            | Cierra la sesión                         |
| POST   | `/api/chat`                   | Chat con Gemini (Bearer + rate limit)    |
| POST   | `/api/image`                  | Genera una imagen (requiere `IMAGE_MODEL`)|
| POST   | `/api/rag/documents`          | Crea un documento de conocimiento (RAG)  |
| GET    | `/api/rag/documents`          | Lista los documentos del usuario         |
| DELETE | `/api/rag/documents/{id}`     | Elimina un documento y sus fragmentos    |

## Funciones de IA (sección 6)

- **Herramientas (function calling)**: el modelo puede invocar `get_current_time`,
  `calculate` y `get_word_count` por sí solo (SDK `google-genai`).
- **Generación de imágenes**: `POST /api/image` usa `IMAGE_MODEL`. Si la variable
  está vacía, el endpoint responde `503` sin romper el resto del servicio.
- **RAG**: los documentos se dividen en fragmentos, se vectorizan con
  `EMBEDDING_MODEL` y se recuperan por similitud coseno para ampliar el contexto
  del chat. Tablas `documents` y `document_chunks`.
- **Frontend**: dictado por voz (Web Speech API), lectura en voz alta,
  modo imagen y gestor de base de conocimiento.

## Seguridad

- CORS restringido a los orígenes de `ALLOWED_ORIGINS`.
- Token de sesión firmado con `SESSION_SECRET` (itsdangerous, con expiración).
- El `access_token` de Discord nunca se expone al cliente.
- La `state` de OAuth está firmada y expira en 10 minutos.
- `state` incluye la URL de retorno validada contra `ALLOWED_ORIGINS` (multi-frontend).
