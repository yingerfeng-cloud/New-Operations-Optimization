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
        }
        with STORE.lock:
            STORE.conversations[cid] = record
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

    def list(self, limit: int = 50) -> list[dict[str, Any]]:
        with STORE.lock:
            records = [dict(record) for record in STORE.conversations.values()]
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
            if conversation_id not in STORE.conversations:
                raise HTTPException(status_code=404, detail="Conversation not found")
            STORE.conversations[conversation_id] = {**STORE.conversations[conversation_id], "title": title, "updated_at": now_text()}
            STORE.save_runtime()
            return dict(STORE.conversations[conversation_id])

    def delete(self, conversation_id: str) -> dict[str, Any]:
        with STORE.lock:
            if conversation_id not in STORE.conversations:
                raise HTTPException(status_code=404, detail="Conversation not found")
            del STORE.conversations[conversation_id]
            STORE.save_runtime()
        return {"deleted": True, "conversation_id": conversation_id}

    def _last_message(self, record: dict[str, Any]) -> str:
        messages = record.get("messages") or []
        if messages:
            return str(messages[-1].get("text") or "")
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
