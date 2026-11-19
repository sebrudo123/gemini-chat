"""Pruebas del protocolo de bloques y del filtro de streaming."""

from coreia_agent import protocol
from coreia_agent.ui import BlockFilter


def test_extracts_tool_with_nested_args():
    text = 'Voy a leerlo.\n<tool>{"tool":"read_file","args":{"path":"a/b.txt"},"reason":"revisar"}</tool>'
    tools = protocol.extract_tools(text)
    assert len(tools) == 1
    assert tools[0]["tool"] == "read_file"
    assert tools[0]["args"] == {"path": "a/b.txt"}
    assert tools[0]["reason"] == "revisar"


def test_ignores_unknown_or_malformed_tools():
    text = (
        '<tool>{"tool":"rm_rf","args":{}}</tool>'
        '<tool>no es json</tool>'
        '<tool>{"tool":"read_file","args":[]}</tool>'
    )
    assert protocol.extract_tools(text) == []


def test_extracts_question_with_options():
    text = (
        '<question>{"header":"Tecnología","prompt":"¿Qué uso?","options":['
        '{"label":"Godot","description":"Videojuegos"},'
        '{"label":"FastAPI","description":"Backend"}]}</question>'
    )
    questions = protocol.extract_questions(text)
    assert len(questions) == 1
    assert questions[0]["header"] == "Tecnología"
    assert [option["label"] for option in questions[0]["options"]] == [
        "Godot",
        "FastAPI",
    ]


def test_visible_text_removes_blocks():
    text = 'Hola<tool>{"tool":"list_dir","args":{}}</tool> mundo'
    assert protocol.visible_text(text) == "Hola mundo"


def test_tool_result_marks_status():
    assert "Estado: ok" in protocol.tool_result("read_file", True, "contenido")
    assert "Estado: error" in protocol.tool_result("read_file", False, "falló")


def test_block_filter_hides_tool_split_across_chunks():
    filter_ = BlockFilter()
    chunks = [
        "Voy a ",
        "revisar.<to",
        'ol>{"tool":"read_file",',
        '"args":{"path":"a.txt"}}</tool>',
        " Listo.",
    ]
    visible = "".join(filter_.feed(chunk) for chunk in chunks) + filter_.flush()
    assert "tool" not in visible
    assert "path" not in visible
    assert visible == "Voy a revisar. Listo."


def test_block_filter_handles_question_blocks():
    filter_ = BlockFilter()
    visible = filter_.feed(
        'Antes de seguir: <question>{"prompt":"¿Cuál?","options":["A","B"]}</question>'
    )
    visible += filter_.flush()
    assert visible == "Antes de seguir: "
