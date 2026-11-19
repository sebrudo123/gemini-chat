"""Herramientas locales del agente.

Todas las rutas quedan confinadas al espacio de trabajo elegido por el
usuario. Las acciones destructivas se confirman en el CLI antes de
ejecutarse.
"""

from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

MAX_OUTPUT = 60_000
MAX_READ = 200_000
COMMAND_TIMEOUT = 120


class ToolError(Exception):
    """Error controlado de una herramienta."""


class Workspace:
    """Espacio de trabajo seguro para el agente."""

    def __init__(self, root: str | Path) -> None:
        self.root = Path(root).expanduser().resolve()
        if not self.root.exists():
            self.root.mkdir(parents=True, exist_ok=True)

    # ------------------------------------------------------------------ #
    # Utilidades
    # ------------------------------------------------------------------ #
    def resolve(self, raw: str) -> Path:
        """Resuelve una ruta y comprueba que no salga del espacio de trabajo."""
        value = str(raw or ".").strip()
        candidate = Path(os.path.expandvars(os.path.expanduser(value)))
        if not candidate.is_absolute():
            candidate = self.root / candidate
        resolved = candidate.resolve()
        if resolved != self.root and self.root not in resolved.parents:
            raise ToolError(
                "La ruta queda fuera del espacio de trabajo permitido: "
                f"{resolved}"
            )
        return resolved

    @staticmethod
    def _truncate(text: str, limit: int = MAX_OUTPUT) -> str:
        if len(text) <= limit:
            return text
        return text[:limit] + f"\n… (recortado, {len(text)} caracteres en total)"

    # ------------------------------------------------------------------ #
    # Herramientas de lectura
    # ------------------------------------------------------------------ #
    def read_file(self, path: str) -> str:
        target = self.resolve(path)
        if not target.is_file():
            raise ToolError(f"No existe el archivo: {target}")
        data = target.read_bytes()
        if len(data) > MAX_READ:
            data = data[:MAX_READ]
        try:
            return data.decode("utf-8")
        except UnicodeDecodeError:
            return data.decode("utf-8", "replace")

    def list_dir(self, path: str = ".") -> str:
        target = self.resolve(path)
        if not target.is_dir():
            raise ToolError(f"No es una carpeta: {target}")
        rows: list[str] = []
        for entry in sorted(target.iterdir(), key=lambda item: item.name.lower()):
            if entry.is_dir():
                rows.append(f"[dir]  {entry.name}/")
            else:
                try:
                    size = entry.stat().st_size
                except OSError:
                    size = 0
                rows.append(f"[file] {entry.name}  ({size} bytes)")
        return "\n".join(rows) if rows else "(carpeta vacía)"

    # ------------------------------------------------------------------ #
    # Herramientas de escritura
    # ------------------------------------------------------------------ #
    def write_file(self, path: str, content: str) -> str:
        target = self.resolve(path)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(str(content), encoding="utf-8")
        return f"Escrito: {target} ({len(str(content))} caracteres)"

    def create_dir(self, path: str) -> str:
        target = self.resolve(path)
        target.mkdir(parents=True, exist_ok=True)
        return f"Carpeta creada: {target}"

    def delete_path(self, path: str) -> str:
        target = self.resolve(path)
        if target == self.root:
            raise ToolError("No se puede borrar la raíz del espacio de trabajo.")
        if target.is_dir():
            shutil.rmtree(target)
            return f"Carpeta eliminada: {target}"
        if target.is_file():
            target.unlink()
            return f"Archivo eliminado: {target}"
        raise ToolError(f"No existe: {target}")

    # ------------------------------------------------------------------ #
    # Comandos
    # ------------------------------------------------------------------ #
    def run_command(self, command: str) -> str:
        value = str(command or "").strip()
        if not value:
            raise ToolError("El comando está vacío.")
        try:
            completed = subprocess.run(
                value,
                shell=True,
                cwd=str(self.root),
                capture_output=True,
                text=True,
                timeout=COMMAND_TIMEOUT,
            )
        except subprocess.TimeoutExpired as exc:
            raise ToolError(
                f"El comando superó {COMMAND_TIMEOUT} segundos y se canceló."
            ) from exc
        output = (completed.stdout or "") + (completed.stderr or "")
        output = self._truncate(output.strip() or "(sin salida)")
        return f"Código de salida: {completed.returncode}\n{output}"

    # ------------------------------------------------------------------ #
    # Ejecución genérica
    # ------------------------------------------------------------------ #
    def execute(self, name: str, args: dict) -> str:
        if name == "read_file":
            return self.read_file(str(args.get("path", "")))
        if name == "list_dir":
            return self.list_dir(str(args.get("path", ".")))
        if name == "write_file":
            return self.write_file(
                str(args.get("path", "")), str(args.get("content", ""))
            )
        if name == "create_dir":
            return self.create_dir(str(args.get("path", "")))
        if name == "delete_path":
            return self.delete_path(str(args.get("path", "")))
        if name == "run_command":
            return self.run_command(str(args.get("command", "")))
        raise ToolError(f"Herramienta desconocida: {name}")


SAFE_TOOLS = {"read_file", "list_dir"}


def is_destructive(name: str) -> bool:
    return name not in SAFE_TOOLS


def describe(name: str, args: dict) -> str:
    """Texto legible para pedir confirmación al usuario."""
    if name == "read_file":
        return f"Leer el archivo {args.get('path', '')}"
    if name == "list_dir":
        return f"Listar la carpeta {args.get('path', '.')}"
    if name == "write_file":
        content = str(args.get("content", ""))
        preview = content[:200].replace("\n", " ")
        return (
            f"Escribir {args.get('path', '')} "
            f"({len(content)} caracteres)\n     {preview}"
        )
    if name == "create_dir":
        return f"Crear la carpeta {args.get('path', '')}"
    if name == "delete_path":
        return f"BORRAR {args.get('path', '')}"
    if name == "run_command":
        return f"Ejecutar el comando: {args.get('command', '')}"
    return f"{name} {args}"
