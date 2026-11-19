"""Salida de terminal del CLI (sin dependencias externas)."""

from __future__ import annotations

import os
import sys

if os.name == "nt":  # habilita secuencias ANSI en Windows 10+
    os.system("")

_COLOR = sys.stdout.isatty() and not os.environ.get("NO_COLOR")

RESET = "\033[0m" if _COLOR else ""
BOLD = "\033[1m" if _COLOR else ""
DIM = "\033[2m" if _COLOR else ""
ACCENT = "\033[96m" if _COLOR else ""
GREEN = "\033[92m" if _COLOR else ""
YELLOW = "\033[93m" if _COLOR else ""
RED = "\033[91m" if _COLOR else ""
GRAY = "\033[90m" if _COLOR else ""


def paint(text: str, color: str) -> str:
    return f"{color}{text}{RESET}"


def banner(backend: str, workspace: str) -> None:
    art = r"""
  ██████╗ ██████╗ ██████╗ ███████╗     ██╗ █████╗
 ██╔════╝██╔═══██╗██╔══██╗██╔════╝     ██║██╔══██╗
 ██║     ██║   ██║██████╔╝█████╗       ██║███████║
 ██║     ██║   ██║██╔══██╗██╔══╝       ██║██╔══██║
 ╚██████╗╚██████╔╝██║  ██║███████╗     ██║██║  ██║
  ╚═════╝ ╚═════╝ ╚═╝  ╚═╝╚══════╝     ╚═╝╚═╝  ╚═╝
"""
    print(paint(art, ACCENT))
    print(f"  {paint('AGENT', BOLD)}  {paint('Core Model V1', GREEN)}")
    print(f"  {paint('backend  ', GRAY)}{backend}")
    print(f"  {paint('workspace', GRAY)}  {workspace}")
    print(paint("  Escribe /help para ver los comandos. Ctrl+C para salir.", GRAY))
    print()


def assistant_label() -> None:
    print(f"\n{paint('core ia ›', ACCENT)} ", end="", flush=True)


def stream(text: str) -> None:
    print(text, end="", flush=True)


def newline() -> None:
    print()


def info(text: str) -> None:
    print(f"{paint('·', GRAY)} {text}")


def ok(text: str) -> None:
    print(f"{paint('✓', GREEN)} {text}")


def warn(text: str) -> None:
    print(f"{paint('!', YELLOW)} {text}")


def error(text: str) -> None:
    print(f"{paint('✗', RED)} {text}", file=sys.stderr)


def tool_card(name: str, description: str, reason: str) -> None:
    print(f"\n{paint('  ⚙ herramienta', YELLOW)} {paint(name, BOLD)}")
    for line in description.splitlines():
        print(f"    {line}")
    if reason:
        print(f"    {paint('motivo:', GRAY)} {reason}")


def rule() -> None:
    print(paint("─" * 60, GRAY))


class BlockFilter:
    """Filtra los bloques <tool>/<question> mientras se hace streaming.

    El usuario ve solo la respuesta legible; los bloques se procesan después
    con ``protocol.extract_tools`` / ``extract_questions``.
    """

    OPEN = {"<tool>": "tool", "<question>": "question"}
    CLOSE = {"tool": "</tool>", "question": "</question>"}

    def __init__(self) -> None:
        self.pending = ""
        self.mode: str | None = None

    def feed(self, chunk: str) -> str:
        self.pending += chunk
        out: list[str] = []
        while True:
            if self.mode is None:
                found = []
                for tag, mode in self.OPEN.items():
                    index = self.pending.find(tag)
                    if index != -1:
                        found.append((index, tag, mode))
                if not found:
                    cut = self._safe_cut(self.pending)
                    out.append(self.pending[:cut])
                    self.pending = self.pending[cut:]
                    break
                index, tag, mode = min(found, key=lambda item: item[0])
                out.append(self.pending[:index])
                self.pending = self.pending[index + len(tag):]
                self.mode = mode
            else:
                close = self.CLOSE[self.mode]
                index = self.pending.find(close)
                if index == -1:
                    keep = self._partial_tail(self.pending, close)
                    self.pending = self.pending[-keep:] if keep else ""
                    break
                self.pending = self.pending[index + len(close):]
                self.mode = None
        return "".join(out)

    def flush(self) -> str:
        if self.mode is not None:
            self.pending = ""
            return ""
        value = self.pending
        self.pending = ""
        return value

    def _safe_cut(self, buffer: str) -> int:
        best = len(buffer)
        for token in list(self.OPEN) + list(self.CLOSE.values()):
            for size in range(1, min(len(token), len(buffer)) + 1):
                if buffer.endswith(token[:size]):
                    best = min(best, len(buffer) - size)
        return best

    @staticmethod
    def _partial_tail(buffer: str, token: str) -> int:
        for size in range(min(len(token) - 1, len(buffer)), 0, -1):
            if buffer.endswith(token[:size]):
                return size
        return 0
