# ADR-0002: Server-Owned Agent Task Kernel

- Status: Accepted
- Date: 2026-08-12
- Supersedes: the temporary optimization-state adapter described in ADR-0001

## Context

The first V3 slice separated chat turns, tool calls, tasks, approvals, and events, but the legacy optimizer still stored one mutable workflow directly on the visible conversation. Model-generated `task_id`, `start_new`, request paraphrases, and Skill names could therefore select or mutate business state. A second task could inherit the first task's parameters, a repeated tool call could create duplicate workflows, and historical V2 state could appear active after restart.

These are ownership failures, not presentation defects. A general Agent needs the model to choose capabilities while the application remains the sole authority for identity, state, validation, and side effects.

## Decision

The Agent runtime uses the following ownership model:

1. **Visible conversation** owns only the user-visible transcript, bounded internal model transcript, turn receipts, and chat delivery state.
2. **Durable task** owns the business workflow identity, lifecycle, revision, selected tool, result, approval chain, and linked optimization run.
3. **Private execution context** is a one-to-one compatibility boundary for a durable optimization task. It contains legacy parameter-collection state and is never listed, rendered, accepted from a client, or sent to the model.
4. **Optimization run** belongs to one task. Public run APIs resolve through that task instead of mutating a conversation-global run independently.

The following invariants are enforced at runtime and repository boundaries:

- The server, never the model, selects or creates a task identifier.
- One conversation has at most one active task for a given task-producing Skill. Older duplicate active tasks are quarantined and their approvals are superseded.
- The exact user turn text is bound to `ToolContext` by the runtime. Parameter extraction never consumes a model paraphrase.
- An optional preferred Skill is trusted typed turn metadata. It is not part of the model-facing tool schema.
- A task-producing tool can execute at most once per turn. Duplicate calls are audited as `tool.skipped` and reuse the first model-safe result projection.
- Full tool results remain authoritative in task/invocation storage. The model sees a bounded projection without internal IDs or oversized solver output.
- Approval is bound to a task revision. Changes supersede an older approval; cancellation and approval resolution commit atomically against terminal task state.
- Task completion uses a conditional update, so a late tool result cannot overwrite a committed cancellation.
- Conversation deletion runs under the same conversation lock as turns and removes its task contexts, tasks, invocations, approvals, events, and linked runs.

## Parameter contract

Optimization input validation is a domain contract, not a sample-data comparison:

- Time and unit dimensions are inferred from submitted data.
- Dynamic dimensions override cardinalities present only in template examples.
- Required-field completeness, schema shape, and business feasibility are separate signals.
- Business checks include nonnegative load, minimum output not exceeding maximum output, initial output within bounds, and aggregate capacity covering load.
- Template sample values are examples. They are never treated as user-approved defaults.

## Migration

Runtime schema version 7 removes shared legacy workflow fields from visible conversations. Pre-contract optimization tasks that have no private execution context are marked `CANCELLED` with `migration_status=QUARANTINED_LEGACY_STATE`; their pending approvals are `SUPERSEDED`, linked nonterminal runs are cancelled, and a `task.quarantined` audit event is appended. User-visible messages remain intact.

The old `/analyze`, `/confirm-*`, and run endpoints remain compatibility APIs during migration, but the Agent workbench does not use them. New behavior is implemented only through V3 turns, tasks, approvals, and events.

## Consequences

- Ordinary conversation and optimization tasks share one ChatGPT-like surface without sharing mutable business state.
- Function Calling decides *which capability to request*; it cannot choose identities or bypass application policy.
- A future Skill can use its own task engine without inheriting the legacy optimizer's state model.
- Removing V2 becomes a bounded decommissioning task rather than another state migration.
