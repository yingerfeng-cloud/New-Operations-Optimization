from __future__ import annotations


SOLVER_CAPABILITIES = {
    "highs": ["LP", "MILP", "QP", "MIQP"],
    "appsi_highs": ["LP", "MILP", "QP", "MIQP"],
    "ipopt": ["NLP"],
    "bonmin": ["MINLP"],
}


def normalize_capability(capability: str) -> str:
    value = str(capability or "").upper()
    if value == "MIP":
        return "MILP"
    return value


def normalize_capabilities(capabilities: list[str]) -> list[str]:
    result = []
    for capability in capabilities or []:
        normalized = normalize_capability(capability)
        if normalized and normalized not in result:
            result.append(normalized)
    return result or ["LP"]


def check_solver_capability(solver_name: str, required_capabilities: list[str]) -> None:
    key = str(solver_name or "highs").lower()
    supported = SOLVER_CAPABILITIES.get(key, [])
    required_capabilities = normalize_capabilities(required_capabilities)
    missing = [capability for capability in required_capabilities if capability not in supported]
    if missing:
        raise RuntimeError(
            f"求解器 {solver_name} 不支持模型所需能力：{missing}。当前支持能力：{supported}。"
        )
