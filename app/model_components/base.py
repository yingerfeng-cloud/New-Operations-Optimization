from __future__ import annotations

from typing import Any, Protocol


class ModelComponentBuilder(Protocol):
    component_type: str
    display_name: str
    category: str
    description: str

    def validate(self, spec: dict[str, Any], context: dict[str, Any]) -> None:
        ...

    def build(self, model: Any, spec: dict[str, Any], context: dict[str, Any]) -> None:
        ...

    def explain(self) -> dict[str, Any]:
        ...
