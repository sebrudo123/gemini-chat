# Core IA — FastAPI + motor gratuito (Pollinations) + Gemini de respaldo

Plataforma de chat con IA de nivel enterprise: backend **FastAPI** con motor propio compatible con OpenAI (**Pollinations gratis por defecto**, sin clave ni registro) y **Gemini** como respaldo, autenticación **Discord OAuth2** con sesiones firmadas (`itsdangerous`) y frontend estático estilo ChatGPT/Gemini.

## Estructura

```
CoreIA/
├── backend/
│   ├── main.py             # API FastAPI (auth Discord + chat Gemini)
│   ├── config.py           # Configuración central (settings)
│   ├── database.py         # Motor y sesiones SQLAlchemy
│   ├── models.py           # User, Conversation, Message, Document, UserMemory...
│   ├── tools.py            # Hora, cálculo y detección de memoria
│   ├── llm.py              # Motor propio compatible con OpenAI (Pollinations por defecto)
│   ├── websearch.py        # Búsqueda web gratis (DuckDuckGo + Jina Reader)
│   ├── rag.py              # RAG: chunking, embeddings y búsqueda semántica
│   ├── plans.py            # Planes y cuotas (free/pro/enterprise)
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

El **login por correo y contraseña** funciona sin configuración adicional
(registro en `POST /api/auth/register`, acceso en `POST /api/auth/login`).

## 2. Variables de entorno

Copia `backend/.env.example` a `backend/.env` y rellena:

```
AI_API_KEY=...            # https://aistudio.google.com/apikey
AI_MODEL=gemini-3.8-flash
AI_MODEL_FALLBACKS=gemini-3.5-flash,gemini-3.5-flash-lite,gemini-3.7-flash,gemini-flash-latest
AI_RETRIES=2

# Motor de chat propio (opcional). Si defines una clave, las respuestas de
# texto salen del modelo abierto y Gemini queda solo como respaldo/embeddings.
# Proveedores: groq, openrouter, cerebras, cloudflare, ollama, pollinations o custom.
LLM_PROVIDER=auto         # auto: primera clave disponible; sin claves, Pollinations
GROQ_API_KEY=             # https://console.groq.com/keys (gratis, sin tarjeta)
LLM_MODEL=                # vacío = llama-3.3-70b-versatile en Groq
LLM_VISION_MODEL=         # vacío = llama-4-scout en Groq (imágenes)
# LLM_PROVIDER=pollinations # sin clave ni registro: GPT-OSS 20B gratuito (texto).
#                           # Es el motor por defecto cuando no hay claves.
# OPENROUTER_API_KEY=...  # opcional: https://openrouter.ai/keys
#   En OpenRouter el modelo por defecto es minimax/minimax-m3.1-flash:free
#   (texto, imágenes y 1M de contexto). Límite gratuito: ~50 peticiones/día.
# LLM_BASE_URL=...        # para Ollama u otro servidor compatible con OpenAI
# LLM_API_KEY=...

IMAGE_MODEL=              # vacío = imágenes gratis con Pollinations (sin clave)
EMBEDDING_MODEL=gemini-embedding-001
RAG_ENABLED=true
RAG_TOP_K=4
SESSION_SECRET=...        # cadena aleatoria larga
DISCORD_CLIENT_ID=...
DISCORD_CLIENT_SECRET=...
DISCORD_REDIRECT_URI=https://TU-BACKEND.onrender.com/api/auth/discord/callback
AUTH_PROVIDERS=discord
FOUNDER_DISCORD_IDS=1439761085040427100   # IDs con acceso al panel de administración
FOUNDER_2FA_REQUIRED=true                  # exige 2FA al fundador antes de usar el chat
FRONTEND_URL=https://TU-FRONTEND
ALLOWED_ORIGINS=https://TU-FRONTEND,http://localhost:5500
DATABASE_URL=postgresql://usuario:password@host:5432/coreia   # opcional (si falta usa SQLite)
REDIS_URL=                # opcional (caché + rate limiting distribuido)
SENTRY_DSN=               # opcional (observabilidad)
ENVIRONMENT=production
RATE_LIMIT=30/minute
AUTH_RATE_LIMIT=10/minute # límite específico de login, registro y verificación 2FA
EMAIL_RELAY_URL=          # opción A) relevo HTTPS propio (Google Apps Script -> tu Gmail)
EMAIL_RELAY_TOKEN=        # token compartido con el relevo
BREVO_API_KEY=            # opción B) API HTTPS (https://app.brevo.com), sin dominio
RESEND_API_KEY=           # opción C) alternativa (requiere dominio verificado)
SMTP_HOST=                # opción D) solo si el host permite SMTP saliente (Render gratis lo bloquea)
SMTP_PORT=587
SMTP_USER=
SMTP_PASSWORD=
EMAIL_FROM=Core IA <tu@gmail.com>
EMAIL_VERIFICATION_REQUIRED=false
TOTP_ISSUER=Core IA
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
  `messages`, `documents`, `document_chunks`, `user_settings`, `usage`; se crean
  automáticamente al arrancar.
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
| POST   | `/api/chat`                   | Chat con el motor configurado (Bearer + rate limit) |
| POST   | `/api/chat/stream`            | Chat en streaming SSE                    |
| POST   | `/api/image`                  | Genera una imagen (Pollinations o `IMAGE_MODEL`) |
| POST   | `/api/study`                  | Resumen, flashcards o quiz de apuntes/PDF |
| GET    | `/api/memory`                 | Lista la memoria del usuario             |
| POST   | `/api/memory`                 | Guarda un dato en la memoria             |
| DELETE | `/api/memory/{id}`            | Olvida un dato                           |
| POST   | `/api/rag/documents`          | Crea un documento de conocimiento (RAG)  |
| GET    | `/api/rag/documents`          | Lista los documentos del usuario         |
| DELETE | `/api/rag/documents/{id}`     | Elimina un documento y sus fragmentos    |
| GET    | `/api/conversations`          | Lista las conversaciones del usuario     |
| GET    | `/api/conversations/{id}`     | Devuelve una conversación con mensajes   |
| PATCH  | `/api/conversations/{id}`     | Renombra una conversación                |
| DELETE | `/api/conversations/{id}`     | Elimina una conversación y sus mensajes  |
| GET    | `/api/settings`               | Preferencias del usuario                 |
| PATCH  | `/api/settings`               | Actualiza preferencias (tema, modelo, RAG)|
| GET    | `/api/plans`                  | Catálogo de planes                       |
| GET    | `/api/usage`                  | Plan actual y consumo del día            |
| DELETE | `/api/account`                | Elimina la cuenta y todos sus datos      |

## Funciones de IA (sección 6)

- **Motor gratuito por defecto**: Pollinations (`openai-fast`, GPT-OSS 20B) sin
  clave ni registro. Si falla, Gemini responde como respaldo.
- **Herramientas**: hora/fecha, cálculo exacto (inyectado en el prompt para que
  funcione con cualquier motor) y memoria.
- **Búsqueda web gratis**: DuckDuckGo + Jina Reader, sin API key. Se activa sola
  para preguntas de actualidad o URLs, o con el botón 🌐 del composer. Las
  respuestas incluyen las fuentes citadas.
- **Memoria**: “recuerda que…” guarda el dato y se inyecta en futuras
  conversaciones. Panel para añadir u olvidar (máximo 50 por usuario).
- **Generación de imágenes**: `POST /api/image` usa Pollinations (Flux) gratis
  cuando `IMAGE_MODEL` está vacío; si defines un modelo de Gemini, usa ese.
- **OCR gratis**: al adjuntar una imagen y usar un motor sin visión, el navegador
  extrae el texto con Tesseract.js (`spa+eng`) y se lo envía al modelo. También
  funciona con PDFs que tengan texto.
- **Modo estudio**: `POST /api/study` genera resúmenes, flashcards o quizzes a
  partir de apuntes o de un PDF. La interfaz permite voltear tarjetas y
  responder el quiz con corrección inmediata.
- **RAG**: los documentos se dividen en fragmentos, se vectorizan con
  `EMBEDDING_MODEL` y se recuperan por similitud coseno para ampliar el contexto
  del chat. Tablas `documents` y `document_chunks`.
- **Frontend**: dictado por voz (Web Speech API), lectura en voz alta y botón
  “Escuchar” por respuesta, modo imagen, modo estudio, base de conocimiento y
  memoria.

> El motor gratuito de Pollinations permite 1 respuesta cada 30 segundos por IP.
> Si se alcanza el límite, Core IA usa Gemini como respaldo cuando `AI_API_KEY`
> está configurada.

## Producto (sección 4)

- **Historial en servidor**: las conversaciones y sus mensajes se guardan en la
  base de datos y se recuperan por usuario. El frontend permite crear, abrir,
  renombrar y eliminar conversaciones.
- **Ajustes de usuario**: tema (oscuro/claro), modelo preferido y uso de la base
  de conocimiento (RAG) por defecto, persistidos en `user_settings`.
- **Planes y cuotas**: `plans.py` define `free` (100 mensajes/día, 5 imágenes/día,
  3 documentos), `pro` (2000/100/50) y `enterprise` (ilimitado). El consumo diario
  se registra en `usage`; el chat, la generación de imágenes y la creación de
  documentos comprueban la cuota y responden `429` al superarla.
- **Cuenta**: `DELETE /api/account` borra conversaciones, mensajes, documentos,
  ajustes y consumo del usuario.

## Autenticación

- **Proveedores**: Discord (OAuth2) más correo/contraseña. `GET /api/auth/providers`
  devuelve los OAuth configurados; el frontend dibuja dinámicamente un botón por
  proveedor (con su icono y color) y siempre muestra el formulario de correo.
- **Correo/contraseña**: `POST /api/auth/register` y `POST /api/auth/login` devuelven
  `{ token, user }`. Las contraseñas se guardan como `pbkdf2_sha256` (200 000
  iteraciones, salt aleatorio). El login por correo está siempre disponible.
- **Identidad**: cada usuario se identifica por `discord_id` o
  `password_hash`/email. Las cuentas con el mismo correo se enlazan.
- **Migración**: al arrancar, `init_db()` añade las columnas nuevas de identidad y
  permite `discord_id` nulo en bases de datos ya existentes.

## Verificación de correo y 2FA

- **Verificación de correo**: al registrarse con correo se envía un enlace firmado
  por **relevo HTTPS**, **Brevo**, **Resend** o **SMTP** (se prueban en ese orden), según
  cuál esté configurado, a `GET /api/auth/email/verify`. El estado se ve en *Ajustes → Correo* y
  puede reenviarse con `POST /api/auth/email/resend`. Si `EMAIL_VERIFICATION_REQUIRED=true`,
  los usuarios con correo sin verificar no podrán chatear. Las cuentas de Discord se
  consideran verificadas.
  - **Relevo HTTPS (recomendado sin dominio)**: define `EMAIL_RELAY_URL` (un Google
    Apps Script publicado como *web app*) y `EMAIL_RELAY_TOKEN`. El script recibe
    `{token, to, subject, html}` y envía con `MailApp.sendEmail` desde tu Gmail; así
    funciona donde SMTP está bloqueado (como el plan gratis de Render). ~100 correos/día.
  - **Brevo (sin dominio)**: define `BREVO_API_KEY`. Usa su API HTTPS. Brevo puede
    reescribir remitentes de correos gratuitos (Gmail/Yahoo) a un dominio suyo por DMARC.
  - **Resend**: alternativa; para enviar a terceros requiere un **dominio verificado**.
  - **SMTP**: solo si el host **no** bloquea SMTP saliente (Gmail con contraseña de
    aplicación). Render gratis lo bloquea.
- **Autenticación en dos pasos (TOTP)**: activable desde *Ajustes → Seguridad*.
  - `POST /api/auth/2fa/setup`: genera el secreto y el código QR (SVG).
  - `POST /api/auth/2fa/enable`: valida el primer código y devuelve 10 códigos de
    respaldo de un solo uso (mostrados una sola vez).
  - `POST /api/auth/2fa/verify`: completa el login pendiente (`{ requires_2fa, pending_token }`
    en el login por correo o `#pending2fa=` en el callback de Discord) aceptando TOTP
    o un código de respaldo.
  - `POST /api/auth/2fa/disable`: desactiva validando TOTP, código de respaldo o contraseña.
  - Requiere la dependencia `pyotp` (y `qrcode` para el QR).

## Panel de administración

- Acceso reservado a los **fundadores** (IDs de Discord en `FOUNDER_DISCORD_IDS`).
  El perfil expone `is_admin` y los endpoints `/api/admin/*` comprueban el permiso
  en el servidor (`403` para el resto).
- `GET /api/admin/stats`: totales de usuarios, conversaciones, mensajes, documentos,
  actividad y mensajes de hoy, y reparto por plan.
- `GET /api/admin/users`: listado de usuarios con plan, nº de chats, documentos,
  notas internas y etiquetas.
- `GET /api/admin/users/{id}`: ficha completa (datos, cuotas y consumo, lista de
  conversaciones y documentos).
- `PATCH /api/admin/users/{id}`: edita plan, estado (activo/baneado), nombre
  visible, usuario, correo, verificación, notas y etiquetas; `reset_2fa` para
  desactivar la 2FA.
- `POST /api/admin/users/{id}/reset-2fa`: restablece la 2FA del usuario.
- `POST /api/admin/users/{id}/resend-verification`: reenvía el correo de verificación.
- `POST /api/admin/users/{id}/logout-all`: cierra todas las sesiones activas
  (incrementa `User.session_epoch`, invalidando los tokens anteriores).
- `GET /api/admin/export/users?format=csv|json`: exporta la lista de usuarios.
- `GET /api/admin/stats?range=7|14|30|90`: métricas con rango, DAU/MAU, top de
  usuarios por mensajes y uso por modelo preferido.
- `GET /api/admin/health`: versión, entorno, uptime y estado de la base de datos,
  caché, Gemini y relevo de correo.
- `GET|PATCH /api/admin/settings`: system prompt, modelo predeterminado,
  temperatura y palabras prohibidas (moderación del chat).
- `GET /api/admin/documents`: todos los documentos de la base RAG con su dueño.
- `GET|DELETE /api/admin/conversations/{id}`: consulta o elimina conversaciones.
- `DELETE /api/admin/documents/{id}`: elimina documentos de conocimiento.
- `DELETE /api/admin/users/{id}`: elimina un usuario y todos sus datos (los
  fundadores están protegidos frente a suspensión, borrado y cambio de plan).
- En el frontend, el fundador ve un botón con forma de escudo en la barra lateral
  que abre el panel (métricas, usuarios con drill-down, flags, avisos y auditoría).

## Seguridad

- CORS restringido a los orígenes de `ALLOWED_ORIGINS`.
- Token de sesión firmado con `SESSION_SECRET` (itsdangerous, con expiración).
- El `access_token` de Discord nunca se expone al cliente.
- La `state` de OAuth está firmada y expira en 10 minutos.
- `state` incluye la URL de retorno validada contra `ALLOWED_ORIGINS` (multi-frontend).

## Discord Rich Presence (app Android)

La app de Android (`android/`) incluye presencia en Discord mediante el **SDK
oficial de Discord** (Social SDK). La capa Java del SDK no expone la presencia,
así que se usa su API C++ desde un módulo nativo JNI
(`android/app/src/main/cpp/discord_rpc.cpp`) enlazado con
`libdiscord_partner_sdk.so` (ABIs `arm64-v8a` y `armeabi-v7a`).

1. En el [Portal de Desarrolladores de Discord](https://discord.com/developers/applications)
   crea una aplicación y copia su **Application ID**.
2. En la app, abre *Ajustes → Discord* e introduce el **Application ID**.
3. La presencia se activa al guardar y se actualiza según el rol y la actividad:
   - **Administrador**: «Administrando Core IA».
   - **Fundador**: «Modificando cosas en Core IA».
   - **Resto**: «Usando Core IA».
   Los textos de administrador/fundador solo se editan y se aplican a esos roles;
   los textos generales los puede personalizar cualquier usuario.
4. Guarda los cambios. Mientras la presencia está activa, la app se mantiene en
   segundo plano y aparece una notificación **«Mostrando en Discord»** con un
   botón **Desactivar** que apaga la presencia al instante. Si la app de Discord
   no está instalada, la presencia se desactiva de forma silenciosa y el resto
   de la app sigue funcionando.

Detalles técnicos:

- `MainActivity` expone el puente `window.DiscordRPC` (`initRpc`, `isAvailable`,
  `getStatus`, `setPresence`, `stopRpc`) y `discord-rpc.js` calcula los textos.
- El módulo nativo llama a `discordpp::RunCallbacks()` cada 500 ms.
- `DiscordPresenceService` (servicio en primer plano, tipo `dataSync`) mantiene
  vivo el proceso y muestra la notificación; `DiscordPresenceReceiver` atiende el
  botón «Desactivar».
- El estado del RPC se muestra en *Ajustes → Discord* para diagnosticar
  problemas (Application ID ausente, SDK no disponible, etc.).
- El APK solo empaqueta ABIs ARM para reducir tamaño; en otras arquitecturas la
  librería no se carga y la función queda deshabilitada.

