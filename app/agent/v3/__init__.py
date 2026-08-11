"""Agent V3 runtime.

The runtime owns turns, tasks, tool calls and approvals. Domain Skills execute
inside task-local contexts and never store workflow state on the visible chat.
"""
