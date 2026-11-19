"""POST /api/agent/chat — respuesta completa del agente."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from lib.agent_app import app  # noqa: E402,F401
