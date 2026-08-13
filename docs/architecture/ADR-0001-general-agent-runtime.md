# ADR-0001: General Agent Runtime with Optimization Skills

- Status: Accepted
- Date: 2026-08-11

## Context

The current Agent API treats a conversation as a parameter-collection wizard for one optimization run. Intent routing, casual-chat rules, parameter extraction, workflow state, invocation, and response copy are coupled inside the old orchestrator. As a result, an active optimization run can capture unrelated messages, conversational replies are template-driven, and the UI must understand internal workflow states.

## Decision

OptiForge will use one general conversational Agent runtime. Operations-research capabilities are exposed to that runtime as strict, registered tools (Skills). The language model decides whether to answer directly or request a tool; application code remains responsible for authorization, validation, deterministic execution, persistence, and audit events.

The V3 runtime owns six independent records:

1. **Conversation**: an ordered internal model transcript containing user, assistant, and tool messages, plus a separate user-visible transcript that does not expose tool protocol payloads.
2. **Turn**: the durable delivery and execution lifecycle for one accepted user request, including attempts, phase, provider diagnostics, and retryability.
3. **Task**: a durable unit of work that can outlive a turn.
4. **Tool invocation**: auditable input, output, status, and error for one tool call.
5. **Event**: an append-only conversation stream consumed by the UI.
6. **Approval**: a resumable decision gate for consequential actions.

The event protocol is stable across Skills: `message.completed`, `turn.retry_started`, `turn.failed`, `tool.started`, `tool.completed`, `tool.failed`, `tool.cancelled`, `tool.skipped`, `task.created`, `task.updated`, `task.quarantined`, `approval.required`, `approval.started`, `approval.resolved`, `approval.failed`, `approval.superseded`, `run.progress`, `run.completed`, and `run.failed`.

## Runtime boundaries

- The model gateway may propose text or strict tool calls; it never executes business code.
- The tool registry is the only path from the model to application capabilities.
- A tool receives an immutable call context and schema-validated arguments.
- Conversation state never implies that a Skill must run. A Skill runs only after an explicit tool call.
- Optimization validation and solving stay deterministic behind the Skill boundary.
- Provider-specific response formats are translated into the internal `ModelTurn` contract.
- A disabled model produces an explicit unavailable response; it does not silently fall back to keyword routing.
- Every client turn carries an idempotency key bound to a request fingerprint. The durable Turn is the idempotency record; successful duplicates are reconstructed from record references, and retryable failures reuse the accepted user message instead of creating another message or Turn.
- Transport or provider failures are Turn state, never assistant prose. Failed attempts are excluded from future model memory while remaining visible as structured activity and an actionable retry card.
- Operational health is measured with the same provider/model/tool protocol used by production Agent turns. A configuration or successful plain-text response is not reported as Function Calling readiness.
- Model input uses a bounded recent-turn window. User messages, typed metadata, cumulative tool arguments, tool-call count, and model-facing tool outputs have explicit limits; authoritative task and invocation results remain intact for audit.
- Task completion is a conditional store update, so a committed cancellation cannot be overwritten by a late tool result.

## Migration

The first vertical slice introduced `/api/agent/v3` alongside the existing API. ADR-0002 replaces its temporary conversation-state adapter with a server-owned task kernel and a private execution context per optimization task.

Subsequent slices will replace that adapter with smaller tools for scenario discovery, schema inspection, parameter drafting, validation, approval, solving, and result explanation. Once the frontend and evaluation suite use the V3 turn/event API, the monolithic `/analyze` route and old routing chain can be removed.

## Consequences

- Ordinary chat and optimization work can coexist in one conversation without task-state hijacking.
- Multiple tasks and future non-optimization Skills share one protocol.
- The UI renders messages and events instead of interpreting backend workflow internals.
- Provider adapters and Skill implementations can evolve independently.
- During migration, V2 and V3 persistence must remain backward compatible.
