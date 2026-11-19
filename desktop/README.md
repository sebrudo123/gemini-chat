# Core IA Studio

App de escritorio para conversar con los agentes de Core IA, gestionar
sesiones y trabajar con archivos del equipo. Sin editor de código: sidebar de
sesiones, chat con streaming, preguntas de opción múltiple y confirmación de
herramientas.

Construida con **Tauri 2** (Rust + WebView) y un frontend ligero en JavaScript.
El modelo siempre se muestra como **Core Model V1**.

## Requisitos

- Node.js 20+
- Rust 1.77.2+ (`rustup`)
- **Linux:** `libwebkit2gtk-4.1-dev`, `libappindicator3-dev`, `librsvg2-dev`,
  `patchelf`, `build-essential`
- **Windows:** WebView2 (viene con Windows 10/11) y Visual Studio Build Tools
  con el workload de C++.

```bash
# Debian/Ubuntu
sudo apt-get install -y libwebkit2gtk-4.1-dev libappindicator3-dev \
  librsvg2-dev patchelf build-essential
```

## Desarrollo

```bash
cd desktop
npm install
npm run tauri dev
```

## Compilar instaladores

```bash
npm run tauri build
```

Los instaladores quedan en:

- Linux: `src-tauri/target/release/bundle/deb/`, `rpm/`, `appimage/`
- Windows: `src-tauri/target/release/bundle/nsis/`, `msi/`

No se publican GitHub Releases: el workflow
`.github/workflows/desktop.yml` compila Linux y Windows y deja los
instaladores como **artifacts** del run.

## Configuración

En **Ajustes** de la app:

- **Backend:** `https://gemini-chat-backend-vyrz.onrender.com`
- **Clave del agente:** el valor de `AGENT_API_KEY` del backend.
- **Espacio de trabajo:** carpeta donde el agente puede leer y escribir.
  Por defecto, tu carpeta personal (`HOME` / `USERPROFILE`).
- **Tema:** oscuro o claro.

La configuración se guarda en el `localStorage` del WebView, en tu equipo.
La clave del proveedor de IA nunca se expone en la app.

## Herramientas y seguridad

El agente puede leer archivos y listar carpetas; para escribir, crear, borrar
o ejecutar comandos **pide permiso** con un modal que muestra la ruta, el
contenido o el comando exacto.

Rust implementa las herramientas con:

- normalización de rutas y comprobación de la ruta real (sin `..` ni symlinks
  que escapen del espacio de trabajo);
- límite de lectura (200 KB) y de salida (60 KB);
- timeout de 120 s para comandos;
- borrado de la raíz bloqueado.

## Sesiones

Se guardan en `localStorage` (`coreia.sessions.v1`). Crear, renombrar,
buscar y eliminar desde la barra lateral. El historial solo se envía al
backend al pedir una respuesta.

## Estructura

```
desktop/
├── index.html
├── package.json
├── vite.config.js
├── src/
│   ├── api.js          # cliente SSE del backend
│   ├── main.js         # UI, sesiones y bucle del agente
│   ├── markdown.js     # Markdown seguro
│   ├── protocol.js     # bloques <tool>/<question>
│   ├── sessions.js     # almacenamiento local
│   └── styles.css
└── src-tauri/
    ├── Cargo.toml
    ├── tauri.conf.json
    ├── capabilities/
    └── src/
        ├── main.rs
        └── lib.rs      # herramientas locales en Rust
```
