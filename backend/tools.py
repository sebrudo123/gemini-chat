"""Herramientas (function calling) que Core IA puede invocar por sí misma.

El SDK google-genai admite *automatic function calling*: basta con pasar
estas funciones en `GenerateContentConfig(tools=[...])` y el modelo decide
cuándo llamarlas. Requieren docstring y anotaciones de tipo.
"""

import ast
import operator
import re
from datetime import datetime, timezone

_OPERATORS = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.Pow: operator.pow,
    ast.Mod: operator.mod,
    ast.FloorDiv: operator.floordiv,
    ast.USub: operator.neg,
    ast.UAdd: operator.pos,
}


def get_current_time() -> str:
    """Devuelve la fecha y hora actual en UTC en formato ISO 8601.

    Úsala siempre que el usuario pregunte por la fecha u hora actual.
    """
    return datetime.now(timezone.utc).isoformat()


def _evaluate(node: ast.AST) -> float:
    if isinstance(node, ast.Expression):
        return _evaluate(node.body)
    if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
        return node.value
    if isinstance(node, ast.BinOp) and type(node.op) in _OPERATORS:
        return _OPERATORS[type(node.op)](_evaluate(node.left), _evaluate(node.right))
    if isinstance(node, ast.UnaryOp) and type(node.op) in _OPERATORS:
        return _OPERATORS[type(node.op)](_evaluate(node.operand))
    raise ValueError("Expresión no permitida")


def calculate(expression: str) -> str:
    """Evalúa una expresión aritmética simple y devuelve el resultado.

    Úsala para operaciones matemáticas, por ejemplo "2 * (3 + 4)".

    Args:
        expression: Expresión aritmética con números y los operadores
            + - * / // % ** y paréntesis.
    """
    try:
        result = _evaluate(ast.parse(expression, mode="eval"))
        return str(result)
    except Exception as exc:  # noqa: BLE001 - se devuelve el error al modelo
        return f"Error al calcular: {exc}"


def get_word_count(text: str) -> str:
    """Cuenta las palabras y caracteres de un texto.

    Args:
        text: El texto cuya longitud se quiere conocer.
    """
    return f"{len(text.split())} palabras, {len(text)} caracteres"


AVAILABLE_TOOLS = [get_current_time, calculate, get_word_count]

_CALC_REQUEST = re.compile(
    r"(?:cu[áa]nto\s+(?:es|son|da|vale)|calcula(?:r)?|calcul[áa]|"
    r"resultado\s+de|opera(?:ci[óo]n)?)\s*:?\s*([0-9][0-9\s+\-*/().]*)",
    re.I,
)
_MEMORY_REQUEST = re.compile(
    r"^\s*(?:recuerda|memoriza|ten en cuenta|no olvides|guarda)\s*"
    r"(?:que\s+|:\s*)?(.{3,500})$",
    re.I | re.S,
)


def maybe_calculate(text: str) -> tuple[str, str] | None:
    """Detecta una operación aritmética explícita y la resuelve sin red."""
    match = _CALC_REQUEST.search(text)
    if not match:
        return None
    expression = match.group(1).strip().rstrip("=.").strip()
    expression = expression.replace("×", "*").replace("÷", "/")
    if len(expression) < 3 or not re.search(r"[0-9]", expression):
        return None
    if not re.search(r"[+\-*/]", expression):
        return None
    result = calculate(expression)
    if result.startswith("Error"):
        return None
    return expression, result


def extract_memory(text: str) -> str | None:
    """Extrae un dato cuando el usuario pide recordarlo explícitamente."""
    match = _MEMORY_REQUEST.match(text.strip())
    if not match:
        return None
    fact = match.group(1).strip().strip('"“”')
    return fact[:500] or None
