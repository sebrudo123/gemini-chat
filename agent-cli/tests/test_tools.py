"""Pruebas de las herramientas locales y del confinamiento de rutas."""

import pytest

from coreia_agent.tools import ToolError, Workspace


def test_write_read_and_list(tmp_path):
    workspace = Workspace(tmp_path)
    workspace.write_file("notas/hola.txt", "contenido")
    assert workspace.read_file("notas/hola.txt") == "contenido"
    listing = workspace.list_dir("notas")
    assert "hola.txt" in listing


def test_create_and_delete(tmp_path):
    workspace = Workspace(tmp_path)
    workspace.create_dir("src")
    assert (tmp_path / "src").is_dir()
    workspace.write_file("src/a.txt", "x")
    workspace.delete_path("src")
    assert not (tmp_path / "src").exists()


def test_rejects_path_traversal(tmp_path):
    workspace = Workspace(tmp_path)
    with pytest.raises(ToolError):
        workspace.read_file("../fuera.txt")
    with pytest.raises(ToolError):
        workspace.write_file("/etc/passwd", "x")


def test_cannot_delete_root(tmp_path):
    workspace = Workspace(tmp_path)
    with pytest.raises(ToolError):
        workspace.delete_path(".")


def test_run_command(tmp_path):
    workspace = Workspace(tmp_path)
    output = workspace.run_command("echo hola")
    assert "hola" in output
    assert "Código de salida: 0" in output


def test_execute_unknown_tool(tmp_path):
    workspace = Workspace(tmp_path)
    with pytest.raises(ToolError):
        workspace.execute("borrar_todo", {})
