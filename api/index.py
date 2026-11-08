import os
import sys

# Añadir la carpeta backend al sys.path para resolución de módulos
CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.dirname(CURRENT_DIR)
BACKEND_DIR = os.path.join(ROOT_DIR, "backend")

if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

# En entorno Serverless desactivamos autostart de Discord bot para evitar cuelgues
os.environ["DISCORD_BOT_AUTOSTART"] = "false"

from main import app
