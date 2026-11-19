# coreia — CLI de agentes de Core IA

CLI de terminal con sesiones, streaming y herramientas locales, al estilo de
los agentes de Antigravity/Qoder. Habla con el backend de Core IA y siempre
muestra el modelo como **Core Model V1**.

## Instalación

Desde la raíz del repositorio:

```bash
pipx install ./agent-cli
# o, sin pipx:
python3 -m pip install --user -e ./agent-cli
```

Comprueba que quedó instalado:

```bash
coreia --help
```

## Configuración

La clave es la variable `AGENT_API_KEY` del backend (no la clave del proveedor
de IA). Se guarda en `~/.coreia/config.json` con permisos `600`.

```bash
coreia config --backend https://coreiabackend.onrender.com --key TU_CLAVE
coreia config --show
coreia doctor
```

También puedes usar variables de entorno:

```bash
export COREIA_BACKEND="https://coreiabackend.onrender.com"
export COREIA_API_KEY="TU_CLAVE"
export COREIA_HOME="$HOME/.coreia"   # opcional
```

## Uso

```bash
coreia                              # chat interactivo (nueva sesión)
coreia run "crea una API en FastAPI" # tarea de una sola vez
coreia sessions                     # lista las sesiones guardadas
coreia resume <id>                  # retoma una sesión
coreia doctor                       # comprueba la conexión
```

Dentro del chat:

| Comando | Descripción |
|---------|-------------|
| `/new` | Nueva sesión |
| `/sessions` | Listar sesiones |
| `/resume <id>` | Retomar una sesión |
| `/title <texto>` | Renombrar la sesión actual |
| `/clear` | Vaciar los mensajes |
| `/workspace <ruta>` | Cambiar la carpeta de trabajo |
| `/model` | Ver el modelo (Core Model V1) |
| `/help` | Ayuda |
| `/exit` | Salir |

## Herramientas locales

El agente puede usar:

- `read_file` y `list_dir` — lectura (sin confirmación).
- `write_file`, `create_dir`, `delete_path`, `run_command` — **siempre piden
  confirmación** mostrando la ruta, el contenido o el comando exacto.

Todas las rutas están confinadas al espacio de trabajo (`~` por defecto).
No se puede salir con `..`, rutas absolutas externas ni enlaces simbólicos.

`-y` / `--yes` aprueba automáticamente las acciones. Úsalo solo en tareas
controladas.

## Sesiones

Se guardan como JSON en `~/.coreia/sessions/`. No se suben a ningún servidor:
solo el historial necesario se envía al backend al pedir una respuesta.

## Seguridad

- La clave del proveedor de IA nunca llega al CLI: el backend la guarda.
- La clave del agente se compara en el backend en tiempo constante.
- Las acciones destructivas se confirman una por una.
- Los errores del proveedor se muestran sin stack traces ni detalles internos.
