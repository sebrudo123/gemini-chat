"""CLI de Core IA Agent.

Uso:
    coreia                     # chat interactivo (nueva sesión)
    coreia run "crea una API"  # tarea de una sola vez
    coreia sessions            # lista las sesiones guardadas
    coreia resume <id>         # retoma una sesión
    coreia config --show       # backend, clave y espacio de trabajo
    coreia doctor              # comprueba la conexión con el backend
"""

from __future__ import annotations

import argparse
import sys
from typing import Any

from . import config, protocol, ui
from .client import AgentClient, AgentError, MODEL_LABEL
from .sessions import SessionStore, default_title, new_session
from .tools import ToolError, Workspace, describe, is_destructive

MAX_STEPS = 8


# --------------------------------------------------------------------------- #
# Utilidades
# --------------------------------------------------------------------------- #
def _mask(key: str) -> str:
    if not key:
        return "(sin configurar)"
    if len(key) <= 8:
        return "•" * len(key)
    return f"{key[:3]}…{key[-3:]}"


def _ensure_key(cfg: dict[str, Any]) -> str:
    """Devuelve la clave del agente.

    Es opcional: los despliegues públicos (Vercel) permiten usarlos sin clave
    y aplican un límite por IP. Si el backend define AGENT_API_KEY, el cliente
    debe configurarla para que responda.
    """
    return config.api_key(cfg)


def _client(cfg: dict[str, Any]) -> AgentClient:
    return AgentClient(str(cfg["backend"]), _ensure_key(cfg))


def _api_messages(session: dict[str, Any]) -> list[dict[str, str]]:
    result = []
    for message in session.get("messages", []):
        role = str(message.get("role", "user"))
        content = str(message.get("content", ""))
        if content:
            result.append({"role": role, "content": content})
    return result


def _ask_question(question: dict[str, Any]) -> str:
    print()
    print(ui.paint(f"? {question['header']}", ui.BOLD))
    print(f"  {question['prompt']}")
    options = question.get("options") or []
    for index, option in enumerate(options, start=1):
        description = f" — {option['description']}" if option.get("description") else ""
        print(f"  {ui.paint(str(index) + ')', ui.ACCENT)} {option['label']}{description}")
    try:
        if not options:
            return input("  Respuesta: ").strip()
        choice = input(
            f"  Elige [1-{len(options)}] o escribe otra respuesta: "
        ).strip()
    except (EOFError, KeyboardInterrupt):
        return ""
    if choice.isdigit() and 1 <= int(choice) <= len(options):
        return str(options[int(choice) - 1]["label"])
    return choice


def _confirm_tool(tool: dict[str, Any], auto_yes: bool) -> bool:
    if not is_destructive(str(tool["tool"])):
        return True
    if auto_yes:
        ui.warn("Acción aprobada automáticamente por --yes.")
        return True
    ui.tool_card(
        str(tool["tool"]),
        describe(str(tool["tool"]), tool.get("args") or {}),
        str(tool.get("reason", "")),
    )
    try:
        answer = input(f"  {ui.paint('¿Permitir? [s/N]', ui.YELLOW)} ").strip().lower()
    except (EOFError, KeyboardInterrupt):
        return False
    return answer in {"s", "si", "sí", "y", "yes"}


def _execute_tool(workspace: Workspace, tool: dict[str, Any]) -> tuple[bool, str]:
    try:
        output = workspace.execute(str(tool["tool"]), tool.get("args") or {})
        return True, output
    except ToolError as exc:
        return False, str(exc)
    except Exception as exc:  # noqa: BLE001 - una herramienta no tumba el CLI
        return False, f"Error inesperado: {exc}"


# --------------------------------------------------------------------------- #
# Turno del agente
# --------------------------------------------------------------------------- #
def agent_turn(
    session: dict[str, Any],
    store: SessionStore,
    client: AgentClient,
    workspace: Workspace,
    auto_yes: bool = False,
) -> None:
    """Completa un turno, ejecutando herramientas y preguntas si hacen falta."""
    for step in range(MAX_STEPS):
        filter_ = ui.BlockFilter()
        chunks: list[str] = []
        printed = False

        try:
            for delta in client.stream(_api_messages(session)):
                chunks.append(delta)
                visible = filter_.feed(delta)
                if visible:
                    if not printed:
                        ui.assistant_label()
                        printed = True
                    ui.stream(visible)
        except AgentError as exc:
            if printed:
                ui.newline()
            ui.error(str(exc))
            return

        tail = filter_.flush()
        if tail:
            if not printed:
                ui.assistant_label()
                printed = True
            ui.stream(tail)
        if printed:
            ui.newline()

        text = "".join(chunks).strip()
        if not text:
            ui.warn("El agente no devolvió texto.")
            return

        session["messages"].append({"role": "assistant", "content": text})
        store.save(session)

        questions = protocol.extract_questions(text)
        if questions:
            answer = _ask_question(questions[0])
            if not answer:
                ui.info("Pregunta omitida; el agente espera tu próximo mensaje.")
                return
            session["messages"].append({"role": "user", "content": answer})
            store.save(session)
            continue

        tools = protocol.extract_tools(text)
        if not tools:
            return

        results: list[str] = []
        for tool in tools:
            if not _confirm_tool(tool, auto_yes):
                ui.warn(f"Rechazado: {tool['tool']}")
                results.append(
                    protocol.tool_result(
                        str(tool["tool"]),
                        False,
                        "El usuario rechazó esta acción. No la repitas sin "
                        "pedir permiso explicando el motivo.",
                    )
                )
                continue

            ok, output = _execute_tool(workspace, tool)
            preview = output.strip().splitlines()[0][:160] if output.strip() else ""
            if ok:
                ui.ok(f"{tool['tool']}: {preview}")
            else:
                ui.error(f"{tool['tool']}: {preview}")
            results.append(protocol.tool_result(str(tool["tool"]), ok, output))

        session["messages"].append({"role": "tool", "content": "\n\n".join(results)})
        store.save(session)

    ui.warn(
        f"Se alcanzó el límite de {MAX_STEPS} pasos seguidos. "
        "Revisa lo hecho antes de continuar."
    )


# --------------------------------------------------------------------------- #
# Comandos
# --------------------------------------------------------------------------- #
def _print_sessions(store: SessionStore) -> None:
    sessions = store.list()
    if not sessions:
        ui.info("No hay sesiones guardadas todavía.")
        return
    print()
    print(f"  {ui.paint('ID', ui.BOLD):<16} {ui.paint('MENSAJES', ui.BOLD):<10} TÍTULO")
    for item in sessions:
        print(
            f"  {ui.paint(item['id'], ui.ACCENT):<16} "
            f"{item['messages']:<10} {item['title']}"
        )
    print()


def _handle_slash(
    raw: str,
    session: dict[str, Any],
    store: SessionStore,
    cfg: dict[str, Any],
    workspace: Workspace,
) -> tuple[str, dict[str, Any] | None, Workspace]:
    """Procesa un comando de barra. Devuelve (acción, sesión, workspace)."""
    parts = raw.strip().split(maxsplit=1)
    command = parts[0].lower()
    argument = parts[1].strip() if len(parts) > 1 else ""

    if command in {"/exit", "/quit", "/salir"}:
        return "exit", None, workspace
    if command in {"/help", "/ayuda"}:
        print(
            f"""
  {ui.paint('Comandos', ui.BOLD)}
  /new              Nueva sesión
  /resume <id>      Retomar una sesión
  /sessions         Listar sesiones
  /title <texto>    Renombrar la sesión actual
  /clear            Vaciar los mensajes de la sesión
  /workspace <ruta> Cambiar la carpeta de trabajo
  /model            Modelo en uso
  /help             Esta ayuda
  /exit             Salir
"""
        )
        return "continue", session, workspace
    if command in {"/new", "/nueva"}:
        store.save(session)
        fresh = new_session()
        store.save(fresh)
        ui.ok(f"Nueva sesión: {fresh['id']}")
        return "new", fresh, workspace
    if command in {"/sessions", "/sesiones"}:
        _print_sessions(store)
        return "continue", session, workspace
    if command in {"/resume", "/retomar"}:
        if not argument:
            ui.warn("Uso: /resume <id>")
            return "continue", session, workspace
        try:
            loaded = store.load(argument)
        except (FileNotFoundError, ValueError) as exc:
            ui.error(str(exc))
            return "continue", session, workspace
        ui.ok(f"Sesión retomada: {loaded['id']} — {loaded.get('title', '')}")
        return "resume", loaded, workspace
    if command in {"/title", "/titulo", "/título"}:
        if not argument:
            ui.warn("Uso: /title <texto>")
            return "continue", session, workspace
        session["title"] = argument[:80]
        store.save(session)
        ui.ok("Título actualizado.")
        return "continue", session, workspace
    if command in {"/clear", "/limpiar"}:
        session["messages"] = []
        store.save(session)
        ui.ok("Sesión vaciada.")
        return "continue", session, workspace
    if command == "/workspace":
        if not argument:
            ui.info(f"Espacio de trabajo: {workspace.root}")
            return "continue", session, workspace
        try:
            new_workspace = Workspace(argument)
        except OSError as exc:
            ui.error(f"No se pudo abrir la carpeta: {exc}")
            return "continue", session, workspace
        cfg["workspace"] = str(new_workspace.root)
        config.save(cfg)
        ui.ok(f"Espacio de trabajo: {new_workspace.root}")
        return "continue", session, new_workspace
    if command == "/model":
        ui.info(f"Modelo: {ui.paint(MODEL_LABEL, ui.BOLD)}")
        return "continue", session, workspace

    ui.warn(f"Comando desconocido: {command}. Escribe /help.")
    return "continue", session, workspace


def _chat_loop(
    session: dict[str, Any],
    store: SessionStore,
    client: AgentClient,
    cfg: dict[str, Any],
    auto_yes: bool,
) -> None:
    workspace = Workspace(config.workspace(cfg))
    ui.banner(str(cfg["backend"]), str(workspace.root))
    if session.get("messages"):
        ui.info(
            f"Retomando «{session.get('title', '')}» "
            f"({len(session['messages'])} mensajes)."
        )

    while True:
        try:
            text = input(f"\n{ui.paint('tú ›', ui.GREEN)} ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            store.save(session)
            ui.info(f"Sesión guardada: {session['id']}")
            return

        if not text:
            continue

        if text.startswith("/"):
            action, updated, workspace = _handle_slash(
                text, session, store, cfg, workspace
            )
            if action == "exit":
                store.save(session)
                ui.info(f"Sesión guardada: {session['id']}")
                return
            if updated is not None:
                session = updated
            continue

        if session.get("title") == "Nueva sesión":
            session["title"] = default_title(text)
        session["messages"].append({"role": "user", "content": text})
        store.save(session)
        agent_turn(session, store, client, workspace, auto_yes=auto_yes)


def cmd_config(cfg: dict[str, Any], args: argparse.Namespace) -> None:
    changed = False
    if args.backend:
        cfg["backend"] = args.backend.rstrip("/")
        changed = True
    if args.key:
        cfg["api_key"] = args.key.strip()
        changed = True
    if args.workspace:
        cfg["workspace"] = str(Workspace(args.workspace).root)
        changed = True
    if changed:
        config.save(cfg)
        ui.ok(f"Configuración guardada en {config.config_path()}")

    print()
    print(f"  backend    {cfg['backend']}")
    print(f"  clave      {_mask(config.api_key(cfg))}")
    print(f"  workspace  {config.workspace(cfg)}")
    print()


def cmd_doctor(cfg: dict[str, Any]) -> None:
    client = _client(cfg)
    ui.info(f"Comprobando {cfg['backend']} ...")
    try:
        data = client.health()
    except AgentError as exc:
        ui.error(str(exc))
        raise SystemExit(1) from exc
    ui.ok(f"Conexión correcta con {data.get('model', MODEL_LABEL)}")
    ui.info(f"Herramientas: {', '.join(data.get('tools', []))}")


def cmd_run(cfg: dict[str, Any], prompt: str, auto_yes: bool) -> None:
    store = SessionStore()
    session = new_session(default_title(prompt))
    session["messages"].append({"role": "user", "content": prompt})
    store.save(session)
    workspace = Workspace(config.workspace(cfg))
    client = _client(cfg)
    ui.info(f"Espacio de trabajo: {workspace.root}")
    agent_turn(session, store, client, workspace, auto_yes=auto_yes)
    print()
    ui.rule()
    ui.info(f"Sesión guardada: {session['id']} (coreia resume {session['id']})")


# --------------------------------------------------------------------------- #
# Punto de entrada
# --------------------------------------------------------------------------- #
def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="coreia",
        description="CLI de agentes de Core IA con sesiones y herramientas locales.",
    )
    parser.add_argument("--backend", help="URL del backend de Core IA")
    parser.add_argument("--key", help="Clave del agente para esta ejecución")
    parser.add_argument(
        "-y",
        "--yes",
        action="store_true",
        help="Aprueba automáticamente las acciones del agente (úsalo con cuidado)",
    )
    subparsers = parser.add_subparsers(dest="command")

    subparsers.add_parser("chat", help="Chat interactivo (por defecto)")

    run_parser = subparsers.add_parser("run", help="Ejecutar una tarea y salir")
    run_parser.add_argument("prompt", nargs="+", help="Lo que debe hacer el agente")

    subparsers.add_parser("sessions", help="Listar sesiones guardadas")

    resume_parser = subparsers.add_parser("resume", help="Retomar una sesión")
    resume_parser.add_argument("session_id")

    config_parser = subparsers.add_parser("config", help="Ver o cambiar la configuración")
    config_parser.add_argument("--backend", help="URL del backend")
    config_parser.add_argument("--key", help="Clave del agente")
    config_parser.add_argument("--workspace", help="Carpeta de trabajo")
    config_parser.add_argument("--show", action="store_true", help="Mostrar la configuración")

    subparsers.add_parser("doctor", help="Comprobar la conexión con el backend")

    return parser


def main(argv: list[str] | None = None) -> None:
    parser = build_parser()
    args = parser.parse_args(argv)

    cfg = config.load()
    if args.backend:
        cfg["backend"] = args.backend.rstrip("/")
    if args.key:
        cfg["api_key"] = args.key.strip()

    command = args.command or "chat"

    try:
        if command == "config":
            cmd_config(cfg, args)
            return
        if command == "doctor":
            cmd_doctor(cfg)
            return
        if command == "sessions":
            _print_sessions(SessionStore())
            return
        if command == "run":
            cmd_run(cfg, " ".join(args.prompt), args.yes)
            return
        if command == "resume":
            store = SessionStore()
            session = store.load(args.session_id)
            _chat_loop(session, store, _client(cfg), cfg, args.yes)
            return

        store = SessionStore()
        session = new_session()
        store.save(session)
        _chat_loop(session, store, _client(cfg), cfg, args.yes)
    except KeyboardInterrupt:
        print()
        ui.info("Hasta luego.")
    except AgentError as exc:
        ui.error(str(exc))
        raise SystemExit(1) from exc
    except FileNotFoundError as exc:
        ui.error(str(exc))
        raise SystemExit(1) from exc
