"""Compatibility imports for the removed shared-conversation adapter.

New code must import :mod:`app.agent.v3.skills.optimization`.  The former
snapshot/hydrate/restore implementation was intentionally removed because it
could not provide task isolation or concurrency safety.
"""

from app.agent.v3.skills.optimization import OptimizationRequest, register_optimization_tool


register_legacy_optimization_tool = register_optimization_tool


__all__ = ["OptimizationRequest", "register_legacy_optimization_tool"]
