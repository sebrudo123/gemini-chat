"""POST /api/agent/chat/stream — respuesta en streaming (SSE)."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from lib.agent_app import app  # noqa: E402,F401
