from __future__ import annotations

import copy
import json
import uuid
from typing import Any

from fastapi import HTTPException

from app.agent.v3.models import TaskStatus
from app.storage.memory_store import STORE
from app.utils import now_text


class AgentV3Store:
    @staticmethod
    def public_task(task: dict[str, Any]) -> dict[str, Any]:
        result = copy.deepcopy(task)
        result.pop("execution_context_id", None)
        return result

    def append_event(
        self,
        conversation_id: str,
        event_type: str,
        payload: dict[str, Any] | None = None,
        *,
        turn_id: str | None = None,
        task_id: str | None = None,
    ) -> dict[str, Any]:
        with STORE.lock:
            if conversation_id not in STORE.conversations:
                raise HTTPException(status_code=404, detail="Conversation not found")
            events = STORE.agent_events.setdefault(conversation_id, [])
            event = {
                "event_id": f"EVT-{uuid.uuid4().hex[:12].upper()}",
                "sequence": len(events) + 1,
                "type": event_type,
                "conversation_id": conversation_id,
                "turn_id": turn_id,
                "task_id": task_id,
                "created_at": now_text(),
                "payload": self._bounded_copy(payload or {}, 100_000),
            }
            events.append(event)
            STORE.save_runtime()
            return copy.deepcopy(event)

    def list_events(self, conversation_id: str, after: int = 0) -> list[dict[str, Any]]:
        self._require_conversation(conversation_id)
        with STORE.lock:
            return copy.deepcopy([
                event
                for event in STORE.agent_events.get(conversation_id, [])
                if int(event.get("sequence") or 0) > after
            ])

    def create_turn(
        self,
        conversation_id: str,
        turn_id: str,
        message: str,
        metadata: dict[str, Any],
        client_turn_id: str | None,
        request_fingerprint: str,
    ) -> dict[str, Any]:
        now = now_text()
        record = {
            "turn_id": turn_id,
            "conversation_id": conversation_id,
            "client_turn_id": client_turn_id,
            "request_fingerprint": request_fingerprint,
            "status": "RUNNING",
            "phase": "MODEL_PENDING",
            "input": message,
            "metadata": copy.deepcopy(metadata),
            "input_message_id": None,
            "response_message_id": None,
            "provider_response_id": None,
            "task_ids": [],
            "approval_ids": [],
            "event_cursor": 0,
            "attempt_count": 1,
            "attempts": [{"attempt": 1, "status": "RUNNING", "started_at": now}],
            "retryable": False,
            "error": None,
            "started_at": now,
            "completed_at": None,
            "duration_ms": None,
            "created_at": now,
            "updated_at": now,
        }
        with STORE.lock:
            conversation = STORE.conversations.get(conversation_id)
            if not conversation or conversation.get("kind") == "task_context":
                raise HTTPException(status_code=404, detail="Conversation not found")
            if turn_id in STORE.agent_turns:
                raise HTTPException(status_code=409, detail="Agent turn already exists")
            if client_turn_id and any(
                turn.get("conversation_id") == conversation_id
                and turn.get("client_turn_id") == client_turn_id
                for turn in STORE.agent_turns.values()
            ):
                raise HTTPException(status_code=409, detail="client_turn_id already exists")
            STORE.agent_turns[turn_id] = record
            STORE.save_runtime()
        return copy.deepcopy(record)

    def get_turn(self, turn_id: str) -> dict[str, Any]:
        with STORE.lock:
            turn = STORE.agent_turns.get(turn_id)
            if not turn:
                raise HTTPException(status_code=404, detail="Agent turn not found")
            return copy.deepcopy(turn)

    def find_turn_by_client_id(self, conversation_id: str, client_turn_id: str) -> dict[str, Any] | None:
        with STORE.lock:
            matches = [
                copy.deepcopy(turn)
                for turn in STORE.agent_turns.values()
                if turn.get("conversation_id") == conversation_id
                and turn.get("client_turn_id") == client_turn_id
            ]
        matches.sort(key=lambda item: str(item.get("created_at") or ""))
        return matches[-1] if matches else None

    def list_turns(self, conversation_id: str) -> list[dict[str, Any]]:
        self._require_conversation(conversation_id)
        with STORE.lock:
            turns = [
                copy.deepcopy(turn)
                for turn in STORE.agent_turns.values()
                if turn.get("conversation_id") == conversation_id
            ]
        return sorted(turns, key=lambda item: str(item.get("created_at") or item.get("started_at") or ""))

    def update_turn(self, turn_id: str, **changes: Any) -> dict[str, Any]:
        with STORE.lock:
            turn = STORE.agent_turns.get(turn_id)
            if not turn:
                raise HTTPException(status_code=404, detail="Agent turn not found")
            if str(turn.get("conversation_id") or "") not in STORE.conversations:
                raise HTTPException(status_code=404, detail="Conversation not found")
            turn.update(copy.deepcopy(changes))
            turn["updated_at"] = now_text()
            snapshot = copy.deepcopy(turn)
            STORE.save_runtime()
        return snapshot

    def start_turn_retry(self, turn_id: str) -> dict[str, Any]:
        now = now_text()
        with STORE.lock:
            turn = STORE.agent_turns.get(turn_id)
            if not turn:
                raise HTTPException(status_code=404, detail="Agent turn not found")
            if turn.get("status") not in {"FAILED", "INTERRUPTED"} or not turn.get("retryable"):
                raise HTTPException(status_code=409, detail="This turn is not retryable")
            attempt = int(turn.get("attempt_count") or 1) + 1
            turn.update({
                "status": "RUNNING",
                "phase": "MODEL_PENDING",
                "attempt_count": attempt,
                "retryable": False,
                "error": None,
                "started_at": now,
                "completed_at": None,
                "duration_ms": None,
                "updated_at": now,
            })
            attempts = list(turn.get("attempts") or [])
            attempts.append({"attempt": attempt, "status": "RUNNING", "started_at": now})
            turn["attempts"] = attempts
            snapshot = copy.deepcopy(turn)
            STORE.save_runtime()
        return snapshot

    def complete_turn(
        self,
        turn_id: str,
        *,
        response_message_id: str,
        provider_response_id: str | None,
        task_ids: list[str],
        approval_ids: list[str],
        event_cursor: int,
    ) -> dict[str, Any]:
        now = now_text()
        with STORE.lock:
            turn = STORE.agent_turns.get(turn_id)
            if not turn:
                raise HTTPException(status_code=404, detail="Agent turn not found")
            attempts = list(turn.get("attempts") or [])
            if attempts:
                attempts[-1] = {**attempts[-1], "status": "SUCCEEDED", "completed_at": now}
            turn.update({
                "status": "SUCCEEDED",
                "phase": "COMPLETED",
                "response_message_id": response_message_id,
                "provider_response_id": provider_response_id,
                "task_ids": list(dict.fromkeys(task_ids)),
                "approval_ids": list(dict.fromkeys(approval_ids)),
                "event_cursor": event_cursor,
                "attempts": attempts,
                "retryable": False,
                "error": None,
                "completed_at": now,
                "duration_ms": self._duration_ms(turn.get("started_at"), now),
                "updated_at": now,
            })
            snapshot = copy.deepcopy(turn)
            STORE.save_runtime()
        return snapshot

    def fail_turn(self, turn_id: str, error: dict[str, Any]) -> dict[str, Any]:
        now = now_text()
        with STORE.lock:
            turn = STORE.agent_turns.get(turn_id)
            if not turn:
                raise HTTPException(status_code=404, detail="Agent turn not found")
            attempts = list(turn.get("attempts") or [])
            if attempts:
                attempts[-1] = {**attempts[-1], "status": "FAILED", "completed_at": now, "error": copy.deepcopy(error)}
            turn.update({
                "status": "FAILED",
                "phase": "FAILED",
                "attempts": attempts,
                "retryable": bool(error.get("retryable")),
                "error": self._bounded_copy(error, 20_000),
                "completed_at": now,
                "duration_ms": self._duration_ms(turn.get("started_at"), now),
                "updated_at": now,
            })
            snapshot = copy.deepcopy(turn)
            STORE.save_runtime()
        return snapshot

    @staticmethod
    def _duration_ms(started_at: Any, completed_at: Any) -> int | None:
        from datetime import datetime

        try:
            started = datetime.fromisoformat(str(started_at))
            completed = datetime.fromisoformat(str(completed_at))
            return max(0, int((completed - started).total_seconds() * 1000))
        except (TypeError, ValueError):
            return None

    def create_task(self, conversation_id: str, turn_id: str, title: str, tool_name: str) -> dict[str, Any]:
        task_id = f"TASK-{uuid.uuid4().hex[:12].upper()}"
        now = now_text()
        task = {
            "task_id": task_id,
            "conversation_id": conversation_id,
            "turn_id": turn_id,
            "created_turn_id": turn_id,
            "last_turn_id": turn_id,
            "title": title,
            "tool_name": tool_name,
            "task_contract_version": 2,
            "execution_context_id": None,
            "status": TaskStatus.PENDING.value,
            "revision": 1,
            "created_at": now,
            "updated_at": now,
            "result": None,
            "error": None,
        }
        with STORE.lock:
            conversation = STORE.conversations.get(conversation_id)
            if not conversation or conversation.get("kind") == "task_context":
                raise HTTPException(status_code=404, detail="Conversation not found")
            STORE.agent_tasks[task_id] = task
            STORE.save_runtime()
        self.append_event(conversation_id, "task.created", {"task": task}, turn_id=turn_id, task_id=task_id)
        return copy.deepcopy(task)

    def update_task(
        self,
        task_id: str,
        *,
        event_turn_id: str | None = None,
        unless_status: set[str] | None = None,
        **changes: Any,
    ) -> dict[str, Any]:
        with STORE.lock:
            task = STORE.agent_tasks.get(task_id)
            if not task:
                raise HTTPException(status_code=404, detail="Agent task not found")
            if str(task.get("conversation_id") or "") not in STORE.conversations:
                raise HTTPException(status_code=404, detail="Conversation not found")
            if unless_status and str(task.get("status") or "") in unless_status:
                return copy.deepcopy(task)
            content_changed = any(
                key in changes and task.get(key) != changes[key]
                for key in {"result", "optimization_run_id"}
            )
            task.update(changes)
            if content_changed:
                task["revision"] = int(task.get("revision") or 0) + 1
            if event_turn_id:
                task["last_turn_id"] = event_turn_id
            task["updated_at"] = now_text()
            snapshot = copy.deepcopy(task)
            STORE.save_runtime()
        self.append_event(
            str(snapshot["conversation_id"]),
            "task.updated",
            {"task": snapshot},
            turn_id=str(event_turn_id or snapshot.get("last_turn_id") or snapshot["turn_id"]),
            task_id=task_id,
        )
        return snapshot

    def get_task(self, task_id: str) -> dict[str, Any]:
        with STORE.lock:
            task = STORE.agent_tasks.get(task_id)
            if not task:
                raise HTTPException(status_code=404, detail="Agent task not found")
            return copy.deepcopy(task)

    def cancel_task(self, task_id: str) -> dict[str, Any]:
        task = self.get_task(task_id)
        if task.get("status") in {
            TaskStatus.SUCCEEDED.value,
            TaskStatus.FAILED.value,
            TaskStatus.CANCELLED.value,
        }:
            return task
        return self.update_task(task_id, status=TaskStatus.CANCELLED.value)

    def list_tasks(self, conversation_id: str) -> list[dict[str, Any]]:
        with STORE.lock:
            rows = [copy.deepcopy(row) for row in STORE.agent_tasks.values() if row.get("conversation_id") == conversation_id]
        return sorted(rows, key=lambda row: str(row.get("created_at") or ""))

    def find_task_by_run_id(self, run_id: str) -> dict[str, Any] | None:
        with STORE.lock:
            rows = [
                copy.deepcopy(task)
                for task in STORE.agent_tasks.values()
                if task.get("optimization_run_id") == run_id
            ]
        rows.sort(key=lambda row: str(row.get("updated_at") or row.get("created_at") or ""))
        return rows[-1] if rows else None

    def find_active_task(self, conversation_id: str, tool_name: str) -> dict[str, Any] | None:
        active_statuses = {
            TaskStatus.PENDING.value,
            TaskStatus.RUNNING.value,
            TaskStatus.WAITING_INPUT.value,
            TaskStatus.APPROVAL_REQUIRED.value,
        }
        rows = [
            task
            for task in self.list_tasks(conversation_id)
            if task.get("tool_name") == tool_name and task.get("status") in active_statuses
        ]
        if not rows:
            return None
        canonical = rows[-1]
        # Older builds could create several active tasks from model-generated
        # start_new flags.  Enforce the invariant at the repository boundary so
        # every caller sees exactly one active task per Skill/conversation.
        for duplicate in rows[:-1]:
            self.update_task(
                str(duplicate["task_id"]),
                event_turn_id=str(canonical.get("last_turn_id") or canonical.get("turn_id") or ""),
                status=TaskStatus.CANCELLED.value,
                error="Superseded by the canonical active task",
                migration_status="SUPERSEDED_DUPLICATE",
            )
            for approval in self.list_approvals_for_conversation(conversation_id, pending_only=True):
                if approval.get("task_id") == duplicate.get("task_id"):
                    self.supersede_approval(str(approval["approval_id"]))
        return self.get_task(str(canonical["task_id"]))

    def create_invocation(
        self,
        conversation_id: str,
        turn_id: str,
        call_id: str,
        tool_name: str,
        arguments: dict[str, Any],
        task_id: str | None,
    ) -> dict[str, Any]:
        invocation_id = f"TOOL-{uuid.uuid4().hex[:12].upper()}"
        now = now_text()
        record = {
            "invocation_id": invocation_id,
            "conversation_id": conversation_id,
            "turn_id": turn_id,
            "call_id": call_id,
            "task_id": task_id,
            "tool_name": tool_name,
            "arguments": copy.deepcopy(arguments),
            "status": "RUNNING",
            "result": None,
            "error": None,
            "created_at": now,
            "updated_at": now,
        }
        with STORE.lock:
            if conversation_id not in STORE.conversations:
                raise HTTPException(status_code=404, detail="Conversation not found")
            STORE.tool_invocations[invocation_id] = record
            STORE.save_runtime()
        return copy.deepcopy(record)

    def finish_invocation(
        self,
        invocation_id: str,
        *,
        result: Any = None,
        error: str | None = None,
        status: str | None = None,
    ) -> dict[str, Any]:
        with STORE.lock:
            record = STORE.tool_invocations.get(invocation_id)
            if not record:
                raise HTTPException(status_code=404, detail="Tool invocation not found")
            record["status"] = status or ("FAILED" if error else "SUCCEEDED")
            record["result"] = copy.deepcopy(result)
            record["error"] = error
            record["updated_at"] = now_text()
            STORE.save_runtime()
            return copy.deepcopy(record)

    def create_approval(
        self,
        task_id: str,
        prompt: str,
        payload: dict[str, Any] | None = None,
        *,
        turn_id: str | None = None,
    ) -> dict[str, Any]:
        task = self.get_task(task_id)
        approval_turn_id = str(turn_id or task.get("last_turn_id") or task["turn_id"])
        task_revision = int(task.get("revision") or 0)
        superseded: list[dict[str, Any]] = []
        with STORE.lock:
            for existing in STORE.agent_approvals.values():
                if existing.get("task_id") != task_id or existing.get("status") not in {"PENDING", "FAILED"}:
                    continue
                if int(existing.get("task_revision") or 0) == task_revision:
                    return copy.deepcopy(existing)
                existing["status"] = "SUPERSEDED"
                existing["updated_at"] = now_text()
                superseded.append(copy.deepcopy(existing))
            approval_id = f"APR-{uuid.uuid4().hex[:12].upper()}"
            now = now_text()
            approval = {
                "approval_id": approval_id,
                "conversation_id": task["conversation_id"],
                "turn_id": approval_turn_id,
                "task_id": task_id,
                "task_revision": task_revision,
                "status": "PENDING",
                "prompt": prompt,
                "payload": copy.deepcopy(payload or {}),
                "decision": None,
                "comment": None,
                "created_at": now,
                "updated_at": now,
            }
            STORE.agent_approvals[approval_id] = approval
            STORE.save_runtime()
        for previous in superseded:
            self.append_event(
                str(task["conversation_id"]),
                "approval.superseded",
                {"approval": previous},
                turn_id=str(previous["turn_id"]),
                task_id=task_id,
            )
        self.append_event(
            str(task["conversation_id"]),
            "approval.required",
            {"approval": approval},
            turn_id=approval_turn_id,
            task_id=task_id,
        )
        return copy.deepcopy(approval)

    def get_approval(self, approval_id: str) -> dict[str, Any]:
        with STORE.lock:
            approval = STORE.agent_approvals.get(approval_id)
            if not approval:
                raise HTTPException(status_code=404, detail="Agent approval not found")
            return copy.deepcopy(approval)

    def list_approvals_for_turn(self, turn_id: str) -> list[dict[str, Any]]:
        with STORE.lock:
            return copy.deepcopy([
                approval
                for approval in STORE.agent_approvals.values()
                if approval.get("turn_id") == turn_id
            ])

    def list_approvals_for_conversation(self, conversation_id: str, *, pending_only: bool = False) -> list[dict[str, Any]]:
        with STORE.lock:
            rows = [
                copy.deepcopy(approval)
                for approval in STORE.agent_approvals.values()
                if approval.get("conversation_id") == conversation_id
                and (not pending_only or approval.get("status") in {"PENDING", "EXECUTING", "FAILED"})
            ]
        return sorted(rows, key=lambda row: str(row.get("created_at") or ""))

    def resolve_approval(self, approval_id: str, decision: str, comment: str | None = None) -> dict[str, Any]:
        task_snapshot: dict[str, Any] | None = None
        with STORE.lock:
            approval = STORE.agent_approvals.get(approval_id)
            if not approval:
                raise HTTPException(status_code=404, detail="Agent approval not found")
            if approval.get("status") not in {"PENDING", "FAILED", "EXECUTING"}:
                return copy.deepcopy(approval)
            task = STORE.agent_tasks.get(str(approval.get("task_id") or ""))
            if not task:
                raise HTTPException(status_code=404, detail="Agent task not found")
            if int(approval.get("task_revision") or 0) != int(task.get("revision") or 0):
                approval["status"] = "SUPERSEDED"
                approval["updated_at"] = now_text()
                STORE.save_runtime()
                raise HTTPException(status_code=409, detail="Approval is stale because the task changed")
            terminal = {
                TaskStatus.SUCCEEDED.value,
                TaskStatus.FAILED.value,
                TaskStatus.CANCELLED.value,
            }
            if decision == "approve" and task.get("status") in terminal:
                raise HTTPException(status_code=409, detail="A terminal task cannot be approved")
            approval["status"] = "EXECUTING" if decision == "approve" else "REJECTED"
            approval["decision"] = decision
            approval["comment"] = comment
            approval["error"] = None
            approval["updated_at"] = now_text()
            task["status"] = TaskStatus.RUNNING.value if decision == "approve" else TaskStatus.CANCELLED.value
            task["updated_at"] = now_text()
            task_snapshot = copy.deepcopy(task)
            snapshot = copy.deepcopy(approval)
            STORE.save_runtime()
        self.append_event(
            str(snapshot["conversation_id"]),
            "task.updated",
            {"task": task_snapshot},
            turn_id=str(snapshot["turn_id"]),
            task_id=str(snapshot["task_id"]),
        )
        self.append_event(
            str(snapshot["conversation_id"]),
            "approval.started" if decision == "approve" else "approval.resolved",
            {"approval": snapshot},
            turn_id=str(snapshot["turn_id"]),
            task_id=str(snapshot["task_id"]),
        )
        return snapshot

    def complete_approval(self, approval_id: str) -> dict[str, Any]:
        with STORE.lock:
            approval = STORE.agent_approvals.get(approval_id)
            if not approval:
                raise HTTPException(status_code=404, detail="Agent approval not found")
            if approval.get("status") != "EXECUTING":
                return copy.deepcopy(approval)
            approval["status"] = "APPROVED"
            approval["updated_at"] = now_text()
            snapshot = copy.deepcopy(approval)
            STORE.save_runtime()
        self.append_event(
            str(snapshot["conversation_id"]),
            "approval.resolved",
            {"approval": snapshot},
            turn_id=str(snapshot["turn_id"]),
            task_id=str(snapshot["task_id"]),
        )
        return snapshot

    def fail_approval(self, approval_id: str, error: str, *, task_revision: int | None = None) -> dict[str, Any]:
        with STORE.lock:
            approval = STORE.agent_approvals.get(approval_id)
            if not approval:
                raise HTTPException(status_code=404, detail="Agent approval not found")
            if approval.get("status") != "EXECUTING":
                return copy.deepcopy(approval)
            approval["status"] = "FAILED"
            approval["error"] = error
            if task_revision is not None:
                approval["task_revision"] = task_revision
            approval["updated_at"] = now_text()
            snapshot = copy.deepcopy(approval)
            STORE.save_runtime()
        self.append_event(
            str(snapshot["conversation_id"]),
            "approval.failed",
            {"approval": snapshot, "error": error},
            turn_id=str(snapshot["turn_id"]),
            task_id=str(snapshot["task_id"]),
        )
        return snapshot

    def supersede_approval(self, approval_id: str) -> dict[str, Any]:
        with STORE.lock:
            approval = STORE.agent_approvals.get(approval_id)
            if not approval:
                raise HTTPException(status_code=404, detail="Agent approval not found")
            if approval.get("status") in {"APPROVED", "REJECTED", "SUPERSEDED"}:
                return copy.deepcopy(approval)
            approval["status"] = "SUPERSEDED"
            approval["updated_at"] = now_text()
            snapshot = copy.deepcopy(approval)
            STORE.save_runtime()
        self.append_event(
            str(snapshot["conversation_id"]),
            "approval.superseded",
            {"approval": snapshot},
            turn_id=str(snapshot["turn_id"]),
            task_id=str(snapshot["task_id"]),
        )
        return snapshot

    @staticmethod
    def _require_conversation(conversation_id: str) -> None:
        with STORE.lock:
            exists = conversation_id in STORE.conversations
        if not exists:
            raise HTTPException(status_code=404, detail="Conversation not found")

    @staticmethod
    def _bounded_copy(value: Any, max_chars: int) -> Any:
        copied = copy.deepcopy(value)
        try:
            serialized = json.dumps(copied, ensure_ascii=False, default=str)
        except Exception:
            serialized = str(copied)
        if len(serialized) <= max_chars:
            return copied
        return {
            "truncated": True,
            "original_size": len(serialized),
            "preview": serialized[:max_chars],
        }


agent_v3_store = AgentV3Store()
