from __future__ import annotations

from collections.abc import Callable
import copy
from dataclasses import dataclass
import re
from typing import Any

from fastapi import HTTPException
from pydantic import BaseModel, ValidationError

from app.agent.v3.models import ToolContext


ToolHandler = Callable[[ToolContext, BaseModel], dict[str, Any]]
ToolResultProjector = Callable[[dict[str, Any]], dict[str, Any]]


@dataclass(frozen=True)
class ToolDefinition:
    name: str
    description: str
    argument_model: type[BaseModel]
    handler: ToolHandler
    creates_task: bool = False
    task_title: str = "Agent task"
    final_response_field: str | None = None
    # Full results remain on the durable task.  Only this deliberately small
    # projection is returned to the language model, keeping internal IDs and
    # execution state out of future prompts.
    model_result_projector: ToolResultProjector | None = None

    def project_result_for_model(self, result: dict[str, Any]) -> dict[str, Any]:
        if self.model_result_projector is None:
            return copy.deepcopy(result)
        return self.model_result_projector(result)

    def model_spec(self) -> dict[str, Any]:
        schema = self._strict_schema(copy.deepcopy(self.argument_model.model_json_schema()))
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": schema,
                "strict": True,
            },
        }

    @classmethod
    def _strict_schema(cls, value: Any) -> Any:
        if isinstance(value, dict):
            for key, item in list(value.items()):
                value[key] = cls._strict_schema(item)
            if value.get("type") == "object" or "properties" in value:
                properties = value.get("properties") or {}
                value["additionalProperties"] = False
                value["required"] = list(properties)
            return value
        if isinstance(value, list):
            return [cls._strict_schema(item) for item in value]
        return value

    def validate(self, arguments: dict[str, Any]) -> BaseModel:
        try:
            return self.argument_model.model_validate(arguments)
        except ValidationError as exc:
            raise HTTPException(
                status_code=422,
                detail={"message": f"Invalid arguments for tool {self.name}", "errors": exc.errors()},
            ) from exc


class ToolRegistry:
    def __init__(self) -> None:
        self._tools: dict[str, ToolDefinition] = {}

    def register(self, definition: ToolDefinition) -> None:
        if not re.fullmatch(r"[A-Za-z0-9_-]+", definition.name):
            raise ValueError(f"Invalid tool name: {definition.name}")
        if definition.name in self._tools:
            raise ValueError(f"Tool already registered: {definition.name}")
        self._tools[definition.name] = definition

    def get(self, name: str) -> ToolDefinition:
        definition = self._tools.get(name)
        if not definition:
            raise HTTPException(status_code=422, detail=f"Unknown Agent tool: {name}")
        return definition

    def model_specs(self) -> list[dict[str, Any]]:
        return [definition.model_spec() for definition in self._tools.values()]


tool_registry = ToolRegistry()
