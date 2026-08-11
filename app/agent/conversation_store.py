from __future__ import annotations

import uuid
from typing import Any

from fastapi import HTTPException

from app.storage.memory_store import STORE
from app.utils import now_text


class ConversationStore:
    def create(self, title: str | None = None) -> dict[str, Any]:
        now = now_text()
        cid = f"CONV-{uuid.uuid4().hex[:8].upper()}"
        record = {
            "conversation_id": cid,
            "title": title or "新会话",
            "created_at": now,
            "updated_at": now,
            "messages": [],
            "status": "CHAT_IDLE",
            "kind": "user",
            "runtime_contract": "agent_v3",
        }
        with STORE.lock:
            STORE.conversations[cid] = record
            STORE.save_runtime()
        return dict(record)

    def create_task_context(self, parent_conversation_id: str, task_id: str) -> dict[str, Any]:
        """Create an execution-only context for one durable Agent task.

        The legacy optimization orchestrator is stateful at conversation scope.
        Giving every V3 task its own private context turns that state into a
        task-local aggregate instead of leaking it into the visible chat.
        """
        self.get_public(parent_conversation_id)
        now = now_text()
        context_id = f"CTX-{uuid.uuid4().hex[:12].upper()}"
        record = {
            "conversation_id": context_id,
            "title": f"Task context {task_id}",
            "created_at": now,
            "updated_at": now,
            "messages": [],
            "recent_turns": [],
            "status": "IDLE",
            "conversation_status": "ACTIVE",
            "kind": "task_context",
            "runtime_contract": "agent_v3_task_context",
            "parent_conversation_id": parent_conversation_id,
            "agent_task_id": task_id,
        }
        with STORE.lock:
            STORE.conversations[context_id] = record
            STORE.save_runtime()
        return dict(record)

    def upsert(self, conversation_id: str | None, values: dict[str, Any]) -> dict[str, Any]:
        cid = conversation_id or f"CONV-{uuid.uuid4().hex[:8].upper()}"
        now = now_text()
        record = {"conversation_id": cid, "updated_at": now, **values}
        with STORE.lock:
            existing = STORE.conversations.get(cid, {})
            if not existing:
                record.setdefault("created_at", now)
                record.setdefault("title", self._title_from_values(values))
            STORE.conversations[cid] = {**existing, **record}
            STORE.save_runtime()
            return dict(STORE.conversations[cid])

    def get(self, conversation_id: str) -> dict[str, Any]:
        with STORE.lock:
            record = STORE.conversations.get(conversation_id)
        if not record:
            raise HTTPException(status_code=404, detail="Conversation not found")
        return dict(record)

    def get_public(self, conversation_id: str) -> dict[str, Any]:
        record = self.get(conversation_id)
        if record.get("kind") == "task_context":
            raise HTTPException(status_code=404, detail="Conversation not found")
        return record

    def list(self, limit: int = 50) -> list[dict[str, Any]]:
        with STORE.lock:
            records = [
                dict(record)
                for record in STORE.conversations.values()
                if record.get("kind") != "task_context"
            ]
        records.sort(key=lambda item: str(item.get("updated_at") or item.get("created_at") or ""), reverse=True)
        return [
            {
                "conversation_id": item.get("conversation_id"),
                "title": item.get("title") or "新会话",
                "updated_at": item.get("updated_at"),
                "last_message": self._last_message(item),
                "status": item.get("status", "collecting_parameters"),
            }
            for item in records[:limit]
        ]

    def rename(self, conversation_id: str, title: str) -> dict[str, Any]:
        title = str(title or "").strip() or "新会话"
        with STORE.lock:
            conversation = STORE.conversations.get(conversation_id)
            if not conversation or conversation.get("kind") == "task_context":
                raise HTTPException(status_code=404, detail="Conversation not found")
            STORE.conversations[conversation_id] = {**STORE.conversations[conversation_id], "title": title, "updated_at": now_text()}
            STORE.save_runtime()
            return dict(STORE.conversations[conversation_id])

    def delete(self, conversation_id: str) -> dict[str, Any]:
        with STORE.lock:
            root = STORE.conversations.get(conversation_id)
            if not root or root.get("kind") == "task_context":
                raise HTTPException(status_code=404, detail="Conversation not found")
            context_ids = {
                cid
                for cid, conversation in STORE.conversations.items()
                if conversation.get("kind") == "task_context"
                and conversation.get("parent_conversation_id") == conversation_id
            }
            target_conversation_ids = {conversation_id, *context_ids}
            for target_id in target_conversation_ids:
                STORE.conversations.pop(target_id, None)
            run_ids = [
                run_id
                for run_id, run in STORE.agent_runs.items()
                if run.get("conversation_id") in target_conversation_ids
            ]
            for run_id in run_ids:
                del STORE.agent_runs[run_id]
            task_ids = [
                task_id
                for task_id, task in STORE.agent_tasks.items()
                if task.get("conversation_id") == conversation_id
            ]
            for task_id in task_ids:
                del STORE.agent_tasks[task_id]
            invocation_ids = [
                invocation_id
                for invocation_id, invocation in STORE.tool_invocations.items()
                if invocation.get("conversation_id") == conversation_id
            ]
            for invocation_id in invocation_ids:
                del STORE.tool_invocations[invocation_id]
            approval_ids = [
                approval_id
                for approval_id, approval in STORE.agent_approvals.items()
                if approval.get("conversation_id") == conversation_id
            ]
            for approval_id in approval_ids:
                del STORE.agent_approvals[approval_id]
            STORE.agent_events.pop(conversation_id, None)
            for context_id in context_ids:
                STORE.agent_events.pop(context_id, None)
            STORE.save_runtime()
        return {
            "deleted": True,
            "conversation_id": conversation_id,
            "deleted_run_count": len(run_ids),
            "deleted_task_count": len(task_ids),
            "deleted_tool_invocation_count": len(invocation_ids),
            "deleted_approval_count": len(approval_ids),
            "deleted_task_context_count": len(context_ids),
        }

    def _last_message(self, record: dict[str, Any]) -> str:
        messages = record.get("messages") or []
        if messages:
            return str(messages[-1].get("text") or messages[-1].get("content") or "")
        questions = record.get("last_questions") or []
        if questions:
            return str(questions[-1])
        return ""

    def _title_from_values(self, values: dict[str, Any]) -> str:
        messages = values.get("messages") or []
        for item in messages:
            if item.get("role") == "user" and item.get("text"):
                text = str(item["text"]).strip()
                return text[:24] or "新会话"
        return "新会话"


conversation_store = ConversationStore()
