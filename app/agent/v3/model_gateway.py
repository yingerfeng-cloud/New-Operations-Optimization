from __future__ import annotations

from typing import Any, Protocol

from app.agent.v3.models import ModelTurn, ToolCall
from app.services.llm_service import llm_service


class ModelGateway(Protocol):
    def complete(self, messages: list[dict[str, Any]], tools: list[dict[str, Any]]) -> ModelTurn: ...


class ConfiguredModelGateway:
    """Translates the configured provider response into the V3 model contract."""

    def complete(self, messages: list[dict[str, Any]], tools: list[dict[str, Any]]) -> ModelTurn:
        if not llm_service.enabled():
            return ModelTurn(
                content=(
                    "当前尚未启用通用语言模型，因此我不能可靠地理解这条消息或自主选择 Skill。"
                    "请先在模型服务中配置并启用模型。"
                )
            )
        response = llm_service.chat_with_tools(messages, tools)
        calls: list[ToolCall] = []
        for item in response.get("tool_calls") or []:
            function = item.get("function") or {}
            try:
                arguments = llm_service.parse_tool_arguments(function.get("arguments"))
                argument_error = None
            except Exception as exc:
                arguments = {}
                argument_error = str(getattr(exc, "detail", exc))
            calls.append(
                ToolCall(
                    call_id=str(item.get("id") or ""),
                    name=str(function.get("name") or ""),
                    arguments=arguments,
                    argument_error=argument_error,
                )
            )
        return ModelTurn(
            content=str(response.get("content") or ""),
            tool_calls=calls,
            provider_response_id=response.get("response_id"),
        )


configured_model_gateway = ConfiguredModelGateway()
