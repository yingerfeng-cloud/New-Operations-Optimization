from __future__ import annotations

import copy
import uuid
from enum import StrEnum
from typing import Any

from fastapi import HTTPException

from app.storage.memory_store import STORE
from app.utils import now_text


class AgentRunStatus(StrEnum):
    DRAFT = "DRAFT"
    ROUTING = "ROUTING"
    CLARIFICATION = "CLARIFICATION"
    PARAMETER_REVIEW = "PARAMETER_REVIEW"
    APPROVAL_REQUIRED = "APPROVAL_REQUIRED"
    READY = "READY"
    QUEUED = "QUEUED"
    RUNNING = "RUNNING"
    SUCCEEDED = "SUCCEEDED"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"


TERMINAL_RUN_STATUSES = {
    AgentRunStatus.SUCCEEDED.value,
    AgentRunStatus.FAILED.value,
    AgentRunStatus.CANCELLED.value,
}


WORKFLOW_TO_RUN_STATUS = {
    "CLARIFICATION_REQUIRED": AgentRunStatus.CLARIFICATION.value,
    "PARAM_COLLECTING": AgentRunStatus.PARAMETER_REVIEW.value,
    "PARAMETER_INCOMPLETE": AgentRunStatus.PARAMETER_REVIEW.value,
    "DEFAULT_CONFIRMING": AgentRunStatus.APPROVAL_REQUIRED.value,
    "READY_TO_INVOKE": AgentRunStatus.READY.value,
    "QUEUED": AgentRunStatus.QUEUED.value,
    "RUNNING": AgentRunStatus.RUNNING.value,
    "RESULT_READY": AgentRunStatus.SUCCEEDED.value,
    "SUCCESS": AgentRunStatus.SUCCEEDED.value,
    "FAILED": AgentRunStatus.FAILED.value,
    "INFEASIBLE": AgentRunStatus.FAILED.value,
    "TIMEOUT": AgentRunStatus.FAILED.value,
    "CANCELLED": AgentRunStatus.CANCELLED.value,
}


def run_status_from_response(response: dict[str, Any], current: str | None = None) -> str:
    workflow = str(response.get("workflow_state") or response.get("status") or "").upper()
    result = response.get("result") if isinstance(response.get("result"), dict) else {}
    result_status = str(result.get("status") or "").upper()
    if result_status in WORKFLOW_TO_RUN_STATUS:
        return WORKFLOW_TO_RUN_STATUS[result_status]
    return WORKFLOW_TO_RUN_STATUS.get(workflow, current or AgentRunStatus.ROUTING.value)


class AgentRunStore:
    def create(self, conversation_id: str, response: dict[str, Any] | None = None) -> dict[str, Any]:
        response = response or {}
        run_id = f"RUN-{uuid.uuid4().hex[:12].upper()}"
        now = now_text()
        record = {
            "run_id": run_id,
            "conversation_id": conversation_id,
            "status": run_status_from_response(response),
            "workflow_state": response.get("workflow_state") or response.get("status") or "ROUTING",
            "title": response.get("display_name") or response.get("agent_skill_name") or "优化运行",
            "created_at": now,
            "updated_at": now,
            "events": [],
            "idempotency_key": None,
            "last_response": None,
        }
        record.update(self._snapshot_fields(response))
        with STORE.lock:
            STORE.agent_runs[run_id] = record
            STORE.save_runtime()
        self.append_event(run_id, "run.created", "已创建优化运行", "正在识别场景与所需参数")
        return self.get(run_id)

    def get(self, run_id: str) -> dict[str, Any]:
        with STORE.lock:
            record = STORE.agent_runs.get(run_id)
            if not record:
                raise HTTPException(status_code=404, detail="Agent run not found")
            return copy.deepcopy(record)

    def list_for_conversation(self, conversation_id: str, limit: int = 20) -> list[dict[str, Any]]:
        with STORE.lock:
            rows = [copy.deepcopy(row) for row in STORE.agent_runs.values() if row.get("conversation_id") == conversation_id]
        rows.sort(key=lambda row: str(row.get("updated_at") or row.get("created_at") or ""), reverse=True)
        return rows[:limit]

    def update_from_response(self, run_id: str, response: dict[str, Any], event_type: str = "run.updated") -> dict[str, Any]:
        with STORE.lock:
            record = STORE.agent_runs.get(run_id)
            if not record:
                raise HTTPException(status_code=404, detail="Agent run not found")
            previous_status = str(record.get("status") or "")
            next_status = run_status_from_response(response, previous_status)
            record.update(self._snapshot_fields(response))
            selected_skill = str(response.get("agent_skill_name") or "")
            candidate_title = next(
                (
                    str(candidate.get("display_name") or "")
                    for candidate in response.get("candidate_skills") or []
                    if isinstance(candidate, dict)
                    and selected_skill
                    and selected_skill
                    in {
                        str(candidate.get("agent_skill_name") or ""),
                        str(candidate.get("platform_skill_name") or ""),
                        str(candidate.get("api_skill_name") or ""),
                    }
                    and candidate.get("display_name")
                ),
                "",
            )
            record["title"] = (
                response.get("display_name")
                or response.get("agent_skill_display_name")
                or candidate_title
                or response.get("agent_skill_name")
                or record.get("title")
                or "优化运行"
            )
            record["status"] = next_status
            record["workflow_state"] = response.get("workflow_state") or response.get("status") or record.get("workflow_state")
            record["updated_at"] = now_text()
            STORE.save_runtime()
        title = self._event_title(event_type, next_status)
        detail = str(response.get("agent_message") or response.get("message") or title)
        return self.append_event(run_id, event_type, title, detail, {"previous_status": previous_status})

    def append_event(
        self,
        run_id: str,
        event_type: str,
        title: str,
        detail: str = "",
        payload: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        with STORE.lock:
            record = STORE.agent_runs.get(run_id)
            if not record:
                raise HTTPException(status_code=404, detail="Agent run not found")
            events = record.setdefault("events", [])
            event = {
                "event_id": f"EVT-{uuid.uuid4().hex[:12].upper()}",
                "sequence": len(events) + 1,
                "type": event_type,
                "status": record.get("status"),
                "title": title,
                "detail": detail,
                "created_at": now_text(),
                "payload": payload or {},
            }
            events.append(event)
            record["updated_at"] = event["created_at"]
            STORE.save_runtime()
            return copy.deepcopy(record)

    def begin_invocation(self, run_id: str, idempotency_key: str) -> tuple[bool, dict[str, Any], dict[str, Any] | None]:
        with STORE.lock:
            record = STORE.agent_runs.get(run_id)
            if not record:
                raise HTTPException(status_code=404, detail="Agent run not found")
            if record.get("idempotency_key") == idempotency_key and record.get("last_response"):
                return False, copy.deepcopy(record), copy.deepcopy(record.get("last_response"))
            if record.get("status") in {AgentRunStatus.SUCCEEDED.value, AgentRunStatus.CANCELLED.value}:
                raise HTTPException(status_code=409, detail="终态运行不能重新启动，请创建新的优化任务")
            if record.get("status") in {AgentRunStatus.QUEUED.value, AgentRunStatus.RUNNING.value}:
                return False, copy.deepcopy(record), None
            record["idempotency_key"] = idempotency_key
            record["status"] = AgentRunStatus.RUNNING.value
            record["workflow_state"] = "RUNNING"
            record["updated_at"] = now_text()
            STORE.save_runtime()
        updated = self.append_event(run_id, "run.started", "求解任务已启动", "正在构建模型并调用求解器")
        return True, updated, None

    def finish_invocation(self, run_id: str, response: dict[str, Any]) -> dict[str, Any]:
        updated = self.update_from_response(run_id, response, "run.completed")
        with STORE.lock:
            STORE.agent_runs[run_id]["last_response"] = copy.deepcopy(response)
            STORE.save_runtime()
        return self.get(run_id)

    def fail_invocation(self, run_id: str, detail: str) -> dict[str, Any]:
        with STORE.lock:
            record = STORE.agent_runs.get(run_id)
            if not record:
                raise HTTPException(status_code=404, detail="Agent run not found")
            record.update({"status": AgentRunStatus.FAILED.value, "workflow_state": "FAILED", "error": detail, "updated_at": now_text()})
            STORE.save_runtime()
        return self.append_event(run_id, "run.failed", "运行失败", detail)

    def cancel(self, run_id: str) -> dict[str, Any]:
        with STORE.lock:
            record = STORE.agent_runs.get(run_id)
            if not record:
                raise HTTPException(status_code=404, detail="Agent run not found")
            if record.get("status") == AgentRunStatus.RUNNING.value:
                raise HTTPException(status_code=409, detail="当前求解器不支持安全中断正在执行的同步任务")
            if record.get("status") in TERMINAL_RUN_STATUSES:
                return copy.deepcopy(record)
            record.update({"status": AgentRunStatus.CANCELLED.value, "workflow_state": "CANCELLED", "updated_at": now_text()})
            STORE.save_runtime()
        return self.append_event(run_id, "run.cancelled", "运行已取消", "该运行不会继续执行")

    def _snapshot_fields(self, response: dict[str, Any]) -> dict[str, Any]:
        task_session = response.get("task_session") if isinstance(response.get("task_session"), dict) else {}
        return {
            "agent_skill_name": response.get("agent_skill_name") or task_session.get("agent_skill_name"),
            "api_skill_name": response.get("api_skill_name") or response.get("resolved_skill_name") or task_session.get("api_skill_name"),
            "model_id": response.get("model_id") or task_session.get("model_id"),
            "parameter_draft": response.get("parameter_draft") or task_session.get("parameter_draft") or {},
            "parameter_sources": response.get("parameter_sources") or task_session.get("parameter_sources") or {},
            "missing_required": response.get("missing_required") or task_session.get("missing_required") or [],
            "invalid_parameters": response.get("invalid_parameters") or task_session.get("invalid_parameters") or [],
            "default_candidates": response.get("can_use_default") or response.get("default_candidates") or task_session.get("default_candidates") or [],
            "ready_to_invoke": bool(response.get("ready_to_invoke") or task_session.get("ready_to_invoke")),
            "invocation_id": response.get("invocation_id") or task_session.get("invocation_id"),
            "task_id": response.get("task_id") or task_session.get("task_id"),
            "result": response.get("result") or task_session.get("result"),
            "objective_value": response.get("objective_value"),
            "response_type": response.get("response_type"),
            "intent": response.get("intent"),
            "route_confidence": response.get("route_confidence"),
            "selection_reason": response.get("selection_reason"),
            "message": response.get("agent_message") or response.get("message"),
        }

    def _event_title(self, event_type: str, status: str) -> str:
        if event_type == "run.completed":
            return "优化运行已完成" if status == AgentRunStatus.SUCCEEDED.value else "优化运行已结束"
        return {
            AgentRunStatus.CLARIFICATION.value: "需要补充场景信息",
            AgentRunStatus.PARAMETER_REVIEW.value: "正在收集运行参数",
            AgentRunStatus.APPROVAL_REQUIRED.value: "等待确认默认值",
            AgentRunStatus.READY.value: "参数已就绪",
            AgentRunStatus.SUCCEEDED.value: "优化运行已完成",
            AgentRunStatus.FAILED.value: "优化运行失败",
        }.get(status, "运行状态已更新")


agent_run_store = AgentRunStore()
