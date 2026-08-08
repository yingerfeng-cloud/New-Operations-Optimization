from __future__ import annotations

from typing import Any

from app.agent.conversation_store import conversation_store
from app.agent.orchestrator import agent_orchestrator
from app.agent.run_store import TERMINAL_RUN_STATUSES, agent_run_store


class AgentRuntimeService:
    """Adds durable run semantics around the existing domain orchestrator."""

    def analyze(self, body: dict[str, Any]) -> dict[str, Any]:
        return self._synchronize(body.get("conversation_id"), agent_orchestrator.analyze(body), "run.analyzed")

    def confirm_defaults(self, body: dict[str, Any]) -> dict[str, Any]:
        return self._synchronize(body.get("conversation_id"), agent_orchestrator.confirm_defaults(body), "approval.defaults_confirmed")

    def apply_sample_parameters(self, body: dict[str, Any]) -> dict[str, Any]:
        return self._synchronize(body.get("conversation_id"), agent_orchestrator.apply_sample_parameters(body), "parameters.sample_applied")

    def explain_result(self, body: dict[str, Any]) -> dict[str, Any]:
        response = agent_orchestrator.explain_result(body)
        return self._synchronize(body.get("conversation_id"), response, "result.explained", preserve_status=True)

    def confirm_invoke(self, body: dict[str, Any]) -> dict[str, Any]:
        conversation_id = str(body.get("conversation_id") or "")
        run = self._resolve_run(conversation_id, body.get("run_id"))
        if not run:
            return self._synchronize(conversation_id, agent_orchestrator.confirm_invoke(body), "run.completed")

        idempotency_key = str(body.get("idempotency_key") or f"invoke:{run['run_id']}")
        accepted, current, cached = agent_run_store.begin_invocation(str(run["run_id"]), idempotency_key)
        if cached:
            return {**cached, "run_id": current["run_id"], "run": current, "idempotent_replay": True}
        if not accepted:
            text = "该优化运行已在执行，请勿重复提交。"
            return {
                "conversation_id": conversation_id,
                "run_id": current["run_id"],
                "run": current,
                "workflow_state": current.get("workflow_state"),
                "status": current.get("status"),
                "message": text,
                "agent_message": text,
                "already_running": True,
            }
        try:
            response = agent_orchestrator.confirm_invoke(body)
            response["run_id"] = current["run_id"]
            finished = agent_run_store.finish_invocation(str(current["run_id"]), response)
            conversation_store.upsert(conversation_id, {"active_run_id": current["run_id"], "conversation_status": "ACTIVE"})
            return {**response, "run_id": current["run_id"], "run": finished}
        except Exception as exc:
            agent_run_store.fail_invocation(str(current["run_id"]), str(getattr(exc, "detail", exc)))
            raise

    def conversation_detail(self, conversation_id: str) -> dict[str, Any]:
        conversation = conversation_store.get(conversation_id)
        runs = agent_run_store.list_for_conversation(conversation_id)
        active = self._resolve_run(conversation_id, conversation.get("active_run_id"), runs=runs)
        return {**conversation, "active_run": active, "runs": runs}

    def conversation_list(self) -> list[dict[str, Any]]:
        rows = conversation_store.list()
        for row in rows:
            runs = agent_run_store.list_for_conversation(str(row.get("conversation_id")), limit=1)
            active = runs[0] if runs else None
            row["active_run_id"] = active.get("run_id") if active else None
            row["active_run_status"] = active.get("status") if active else None
        return rows

    def get_run(self, run_id: str) -> dict[str, Any]:
        return agent_run_store.get(run_id)

    def get_run_events(self, run_id: str, after: int = 0) -> list[dict[str, Any]]:
        return [event for event in agent_run_store.get(run_id).get("events", []) if int(event.get("sequence") or 0) > after]

    def cancel_run(self, run_id: str) -> dict[str, Any]:
        return agent_run_store.cancel(run_id)

    def _synchronize(
        self,
        requested_conversation_id: str | None,
        response: dict[str, Any],
        event_type: str,
        preserve_status: bool = False,
    ) -> dict[str, Any]:
        conversation_id = str(response.get("conversation_id") or requested_conversation_id or "")
        if not conversation_id or not self._response_has_task(response):
            return response
        existing = conversation_store.get(conversation_id)
        run = self._resolve_run(conversation_id, response.get("run_id") or existing.get("active_run_id"))
        workflow = str(response.get("workflow_state") or response.get("status") or "").upper()
        if run and run.get("status") in TERMINAL_RUN_STATUSES and workflow not in {"RESULT_READY", "SUCCESS", "FAILED", "INFEASIBLE", "TIMEOUT", "CANCELLED"}:
            run = None
        if not run:
            run = agent_run_store.create(conversation_id, response)
        if preserve_status:
            response = {**response, "workflow_state": run.get("workflow_state"), "status": run.get("status")}
        run = agent_run_store.update_from_response(str(run["run_id"]), response, event_type)
        conversation_store.upsert(conversation_id, {"active_run_id": run["run_id"], "conversation_status": "ACTIVE"})
        return {**response, "run_id": run["run_id"], "run": run}

    def _resolve_run(
        self,
        conversation_id: str,
        run_id: Any = None,
        *,
        runs: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any] | None:
        if run_id:
            try:
                run = agent_run_store.get(str(run_id))
                if run.get("conversation_id") == conversation_id:
                    return run
            except Exception:
                pass
        rows = runs if runs is not None else agent_run_store.list_for_conversation(conversation_id, limit=1)
        return rows[0] if rows else None

    def _response_has_task(self, response: dict[str, Any]) -> bool:
        if response.get("task_session"):
            return True
        return bool(response.get("agent_skill_name") or response.get("api_skill_name") or response.get("resolved_skill_name") or response.get("parameter_draft"))


agent_runtime_service = AgentRuntimeService()
