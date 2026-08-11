from __future__ import annotations

import copy
from typing import Any

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict

from app.agent.conversation_store import conversation_store
from app.agent.v3.models import ToolContext
from app.agent.v3.store import agent_v3_store
from app.agent.v3.tools import ToolDefinition, ToolRegistry
from app.services.agent_runtime_service import agent_runtime_service


TASK_CONTRACT_VERSION = 2


class OptimizationRequest(BaseModel):
    """Model-owned routing hints only.

    The request text and durable task identity intentionally do not belong to
    the model-facing schema.  The runtime binds both from the actual turn.
    """

    model_config = ConfigDict(extra="forbid")

    pass


class OptimizationTaskEngine:
    """Anti-corruption boundary between Agent V3 and the stateful optimizer.

    A visible chat is a transcript.  A durable Agent task is a workflow.  The
    old optimizer stores workflow state on a conversation, so every V3 task is
    assigned a private execution conversation.  This produces a strict 1:1
    task/state/run chain without snapshot/restore races or cross-task leakage.
    """

    def ensure_execution_context(self, task: dict[str, Any]) -> dict[str, Any]:
        context_id = str(task.get("execution_context_id") or "").strip()
        if context_id:
            try:
                context = conversation_store.get(context_id)
            except HTTPException:
                context = None
            if (
                context
                and context.get("kind") == "task_context"
                and context.get("parent_conversation_id") == task.get("conversation_id")
                and context.get("agent_task_id") == task.get("task_id")
            ):
                return context

        context = conversation_store.create_task_context(
            str(task["conversation_id"]),
            str(task["task_id"]),
        )
        agent_v3_store.update_task(
            str(task["task_id"]),
            event_turn_id=str(task.get("last_turn_id") or task.get("turn_id") or ""),
            execution_context_id=context["conversation_id"],
            task_contract_version=TASK_CONTRACT_VERSION,
        )
        return context

    def analyze(self, context: ToolContext, skill_name: str | None) -> dict[str, Any]:
        task = self._task(context.task_id)
        execution = self.ensure_execution_context(task)
        response = agent_runtime_service.analyze(
            {
                "conversation_id": execution["conversation_id"],
                # Exact user text is runtime-owned.  Parameter extraction must
                # never run on a model paraphrase.
                "message": context.user_message,
                "skill_name": skill_name,
                "agent_skill_name": skill_name,
            }
        )
        return self._public_result(task, response)

    def confirm_defaults(self, task: dict[str, Any], run_id: str | None) -> dict[str, Any]:
        execution = self.ensure_execution_context(task)
        response = agent_runtime_service.confirm_defaults(
            {"conversation_id": execution["conversation_id"], "run_id": run_id}
        )
        return self._public_result(task, response)

    def confirm_invoke(self, task: dict[str, Any], run_id: str | None, idempotency_key: str) -> dict[str, Any]:
        execution = self.ensure_execution_context(task)
        response = agent_runtime_service.confirm_invoke(
            {
                "conversation_id": execution["conversation_id"],
                "run_id": run_id,
                "idempotency_key": idempotency_key,
            }
        )
        return self._public_result(task, response)

    @staticmethod
    def cancel_run(task: dict[str, Any]) -> dict[str, Any] | None:
        run_id = task.get("optimization_run_id")
        if not run_id:
            return None
        return agent_runtime_service.cancel_run(str(run_id))

    @staticmethod
    def model_projection(result: dict[str, Any]) -> dict[str, Any]:
        """Return only business state the model needs for its next sentence."""
        return {
            key: copy.deepcopy(result.get(key))
            for key in (
                "workflow_state",
                "status",
                "agent_message",
                "resolved_skill_name",
                "api_skill_name",
                "missing_required",
                "invalid_parameters",
                "can_use_default",
                "requires_default_confirmation",
                "ready_to_invoke",
            )
            if result.get(key) is not None
        }

    @staticmethod
    def _task(task_id: str | None) -> dict[str, Any]:
        if not task_id:
            raise HTTPException(status_code=500, detail="Optimization Skill requires a durable task")
        return agent_v3_store.get_task(task_id)

    @staticmethod
    def _public_result(task: dict[str, Any], response: dict[str, Any]) -> dict[str, Any]:
        public = copy.deepcopy(response)
        public["conversation_id"] = task["conversation_id"]
        public["task_contract_version"] = TASK_CONTRACT_VERSION
        run = public.get("run")
        if isinstance(run, dict):
            run["conversation_id"] = task["conversation_id"]
            run.pop("parent_conversation_id", None)
        # Execution-context IDs are an implementation detail and must never be
        # rendered, returned to the model, or accepted back from a client.
        public.pop("execution_context_id", None)
        return public


optimization_task_engine = OptimizationTaskEngine()


def _run_optimization(context: ToolContext, arguments: BaseModel) -> dict[str, Any]:
    OptimizationRequest.model_validate(arguments.model_dump())
    return optimization_task_engine.analyze(context, context.preferred_skill)


def register_optimization_tool(registry: ToolRegistry) -> None:
    registry.register(
        ToolDefinition(
            name="optimization_create_or_continue",
            description=(
                "Create or continue the conversation's current operations-research task. You MUST call this when the "
                "user asks to create, run, continue, or modify an optimization, scheduling, dispatch, allocation, "
                "or planning task, even when required parameters are missing, and when the user supplies data for "
                "that task. Task identity, Skill routing, and the exact user message are bound by the runtime; "
                "never invent IDs, Skill names, or copy parameter values into arguments."
            ),
            argument_model=OptimizationRequest,
            handler=_run_optimization,
            creates_task=True,
            task_title="Operations research optimization",
            final_response_field="agent_message",
            model_result_projector=OptimizationTaskEngine.model_projection,
        )
    )
