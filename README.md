# Chat IA — Gemini + FastAPI + Frontend estático

Proyecto de chat con IA: backend en **FastAPI** conectado a **Google Gemini** (`gemini-3.8-flash`) y frontend web estático (HTML/CSS/JS).

## Estructura

```
CoreIA/
├── backend/
│   ├── main.py            # API FastAPI (endpoint /api/chat)
│   ├── requirements.txt   # Dependencias
│   ├── Procfile           # Comando de arranque (Render/Railway)
│   ├── .env               # Tu API key (NO se sube a git)
│   └── .gitignore
├── index.html             # Interfaz de chat (modo oscuro)
├── script.js              # Lógica del frontend
└── render.yaml            # Config de despliegue en Render
```

## 1. Local

```bash
cd backend
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

Crea `backend/.env`:

```
AI_API_KEY=tu_api_key_de_gemini
```

Arranca:

```bash
uvicorn main:app --reload
```

El backend queda en `http://127.0.0.1:8000`.

## 2. Frontend

Abre `index.html` en el navegador. Para desarrollo local, cambia en `script.js`:

```js
const BACKEND_URL = "http://127.0.0.1:8000";
```

## 3. Despliegue en Render

1. Sube el repo a GitHub.
2. En Render: **New → Web Service → conecta tu repo**.
3. Si usas `render.yaml` (Blueprint), Render lo detecta automáticamente.
   - **Root Directory**: `backend`
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `uvicorn main:app --host 0.0.0.0 --port $PORT`
4. En **Environment Variables**, agrega `AI_API_KEY` con tu clave.
5. Copia la URL pública (ej. `https://gemini-chat-backend.onrender.com`) y pégala en `script.js`:

```js
const BACKEND_URL = "https://tu-backend.onrender.com";
```

6. Sube el frontend (GitHub Pages, Netlify, Vercel) o publícalo donde prefieras.
