from __future__ import annotations

from collections.abc import Iterable, Mapping
from typing import Any

from app.model_components.lifecycle import COMPONENT_PUBLISHED_STATUS, component_lifecycle_status


def component_id(component: Mapping[str, Any]) -> str:
    return str(component.get("component_id") or component.get("type") or component.get("code") or "").strip()


def component_dependency_ids(component: Mapping[str, Any]) -> list[str]:
    values = [
        *(component.get("depends_on") if isinstance(component.get("depends_on"), list) else []),
        *(component.get("dependencies") if isinstance(component.get("dependencies"), list) else []),
    ]
    result: list[str] = []
    seen: set[str] = set()
    for value in values:
        dependency_id = str(value or "").strip()
        if not dependency_id or dependency_id in seen:
            continue
        seen.add(dependency_id)
        result.append(dependency_id)
    return result


def merged_component_dependency_ids(*components: Mapping[str, Any]) -> list[str]:
    result: list[str] = []
    for component in components:
        for dependency_id in component_dependency_ids(component):
            if dependency_id not in result:
                result.append(dependency_id)
    return result


def component_is_available(component: Mapping[str, Any]) -> bool:
    return component_lifecycle_status(component) == COMPONENT_PUBLISHED_STATUS


def build_dependency_graph(components: Iterable[Mapping[str, Any]]) -> dict[str, list[str]]:
    graph: dict[str, list[str]] = {}
    for component in components:
        identifier = component_id(component)
        if not identifier:
            continue
        graph[identifier] = list(dict.fromkeys([*graph.get(identifier, []), *component_dependency_ids(component)]))
    return graph


def _canonical_cycle(cycle: list[str]) -> tuple[str, ...]:
    nodes = cycle[:-1]
    if not nodes:
        return ()
    rotations = [tuple([*nodes[index:], *nodes[:index]]) for index in range(len(nodes))]
    best = min(rotations)
    return (*best, best[0])


def find_dependency_cycles(graph: Mapping[str, Iterable[str]]) -> list[list[str]]:
    next_index = 0
    indices: dict[str, int] = {}
    low_links: dict[str, int] = {}
    stack: list[str] = []
    on_stack: set[str] = set()
    strongly_connected: list[list[str]] = []
    cycles: dict[tuple[str, ...], list[str]] = {}

    def connect(identifier: str) -> None:
        nonlocal next_index
        indices[identifier] = next_index
        low_links[identifier] = next_index
        next_index += 1
        stack.append(identifier)
        on_stack.add(identifier)
        for dependency_id in graph.get(identifier, []):
            if dependency_id not in graph:
                continue
            if dependency_id not in indices:
                connect(dependency_id)
                low_links[identifier] = min(low_links[identifier], low_links[dependency_id])
            elif dependency_id in on_stack:
                low_links[identifier] = min(low_links[identifier], indices[dependency_id])
        if low_links[identifier] == indices[identifier]:
            members: list[str] = []
            while stack:
                member = stack.pop()
                on_stack.discard(member)
                members.append(member)
                if member == identifier:
                    break
            strongly_connected.append(members)

    def path_within(source: str, target: str, members: set[str]) -> list[str] | None:
        queue: list[list[str]] = [[source]]
        visited = {source}
        while queue:
            path = queue.pop(0)
            current = path[-1]
            if current == target:
                return path
            for next_identifier in sorted(identifier for identifier in graph.get(current, []) if identifier in members):
                if next_identifier in visited:
                    continue
                visited.add(next_identifier)
                queue.append([*path, next_identifier])
        return None

    for identifier in sorted(graph):
        if identifier not in indices:
            connect(identifier)
    for component in strongly_connected:
        members = set(component)
        if len(component) == 1:
            identifier = component[0]
            if identifier in graph.get(identifier, []):
                cycles[(identifier, identifier)] = [identifier, identifier]
            continue
        for start in sorted(component):
            neighbors = sorted(identifier for identifier in graph.get(start, []) if identifier in members)
            for neighbor in neighbors:
                path = path_within(neighbor, start, members)
                if not path:
                    continue
                cycle_key = _canonical_cycle([start, *path])
                cycles[cycle_key] = list(cycle_key)
                break
    return [cycles[key] for key in sorted(cycles)]


def selected_dependency_errors(
    enabled_ids: Iterable[str],
    dependency_map: Mapping[str, Iterable[str]],
    *,
    known_ids: Iterable[str] | None = None,
    available_ids: Iterable[str] | None = None,
) -> list[dict[str, Any]]:
    enabled = {
        str(identifier).strip()
        for identifier in enabled_ids
        if identifier is not None and str(identifier).strip()
    }
    known = (
        {
            str(identifier).strip()
            for identifier in known_ids
            if identifier is not None and str(identifier).strip()
        }
        if known_ids is not None
        else set(dependency_map)
    )
    available = (
        {
            str(identifier).strip()
            for identifier in available_ids
            if identifier is not None and str(identifier).strip()
        }
        if available_ids is not None
        else None
    )
    errors: list[dict[str, Any]] = []

    for identifier in sorted(enabled):
        if identifier not in known:
            errors.append(
                {
                    "field": "components",
                    "error": "unknown component",
                    "error_code": "UNKNOWN_COMPONENT",
                    "component_id": identifier,
                    "message": f"组件 {identifier} 不存在",
                    "suggestion": "请从组件库重新选择有效组件。",
                }
            )
            continue
        if available is not None and identifier not in available:
            errors.append(
                {
                    "field": "components",
                    "error": "component unavailable",
                    "error_code": "COMPONENT_UNAVAILABLE",
                    "component_id": identifier,
                    "message": f"组件 {identifier} 尚未发布、未实现或已停用",
                    "suggestion": "请先发布并启用该组件，或从选择中移除。",
                }
            )
        for dependency_id in sorted(set(dependency_map.get(identifier, []))):
            if dependency_id == identifier:
                errors.append(
                    {
                        "field": "components",
                        "error": "self component dependency",
                        "error_code": "SELF_DEPENDENCY",
                        "component_id": identifier,
                        "dependency_id": dependency_id,
                        "message": f"组件 {identifier} 不能依赖自身",
                        "suggestion": "请删除自依赖。",
                    }
                )
            elif dependency_id not in known:
                errors.append(
                    {
                        "field": "components",
                        "error": "component dependency not found",
                        "error_code": "DEPENDENCY_NOT_FOUND",
                        "component_id": identifier,
                        "missing_dependency": dependency_id,
                        "message": f"组件 {identifier} 依赖组件 {dependency_id} 不存在",
                        "suggestion": f"请先创建并发布依赖组件 {dependency_id}，或删除该依赖。",
                    }
                )
            elif available is not None and dependency_id not in available:
                errors.append(
                    {
                        "field": "components",
                        "error": "component dependency unavailable",
                        "error_code": "DEPENDENCY_UNAVAILABLE",
                        "component_id": identifier,
                        "dependency_id": dependency_id,
                        "message": f"组件 {identifier} 的依赖组件 {dependency_id} 尚未发布、未实现或已停用",
                        "suggestion": f"请先发布并启用依赖组件 {dependency_id}。",
                    }
                )
            elif dependency_id not in enabled:
                errors.append(
                    {
                        "field": "components",
                        "error": "missing component dependency",
                        "error_code": "MISSING_DEPENDENCY",
                        "component_id": identifier,
                        "missing_dependency": dependency_id,
                        "message": f"组件 {identifier} 缺少依赖组件 {dependency_id}",
                        "suggestion": f"请加入依赖组件 {dependency_id}。",
                    }
                )

    enabled_graph = {
        identifier: [
            dependency_id
            for dependency_id in dependency_map.get(identifier, [])
            if dependency_id in enabled and dependency_id != identifier
        ]
        for identifier in enabled
        if identifier in known
    }
    for cycle in find_dependency_cycles(enabled_graph):
        errors.append(
            {
                "field": "components",
                "error": "cyclic component dependency",
                "error_code": "CYCLIC_DEPENDENCY",
                "component_id": cycle[0],
                "cycle": cycle,
                "message": f"组件依赖存在循环：{' → '.join(cycle)}",
                "suggestion": "请移除循环中的至少一条依赖关系。",
            }
        )
    return errors
