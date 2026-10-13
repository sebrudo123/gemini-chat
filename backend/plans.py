"""Definición de planes y cuotas de Core IA.

Los límites `None` significan ilimitado. El valor del plan del usuario se
guarda en `User.plan` (por defecto `free`).
"""

from typing import Any

PLAN_LIMITS: dict[str, dict[str, int | None]] = {
    "free": {"messages_per_day": 100, "images_per_day": 5, "documents": 3},
    "pro": {"messages_per_day": 2000, "images_per_day": 100, "documents": 50},
    "enterprise": {"messages_per_day": None, "images_per_day": None, "documents": None},
}

PLANS: dict[str, dict[str, Any]] = {
    "free": {"name": "Free", "price": "0 €", "limits": PLAN_LIMITS["free"]},
    "pro": {"name": "Pro", "price": "9 €/mes", "limits": PLAN_LIMITS["pro"]},
    "enterprise": {
        "name": "Enterprise",
        "price": "A medida",
        "limits": PLAN_LIMITS["enterprise"],
    },
}


def limits_for(plan: str) -> dict[str, int | None]:
    """Devuelve los límites del plan indicado (o los de `free`)."""
    return PLAN_LIMITS.get(plan, PLAN_LIMITS["free"])
