from __future__ import annotations

from app.api import components as component_api
from app.model_components.dependency_graph import (
    build_dependency_graph,
    component_dependency_ids,
    component_is_available,
    find_dependency_cycles,
    merged_component_dependency_ids,
    selected_dependency_errors,
)
from app.model_components.formula_components import normalize_component_payload, validate_component_definition
from app.model_components.registry import component_definition, get_component_builder
from app.model_draft import finalize_model_draft


def test_dependency_fields_are_merged_trimmed_and_deduplicated() -> None:
    payload = {
        "component_id": "merged_component",
        "depends_on": [" base ", "shared"],
        "dependencies": ["shared", "legacy", ""],
    }

    assert component_dependency_ids(payload) == ["base", "shared", "legacy"]
    normalized = normalize_component_payload(payload)
    assert normalized["depends_on"] == ["base", "shared", "legacy"]
    assert normalized["dependencies"] == ["base", "shared", "legacy"]


def test_dependency_metadata_is_owned_by_the_component_definition() -> None:
    builder = get_component_builder("hydro_volume_bounds")
    definition = component_definition("hydro_volume_bounds", builder)

    assert builder.depends_on == ["hydro_initial_volume"]
    assert component_dependency_ids(definition) == builder.depends_on
    assert merged_component_dependency_ids(
        {"depends_on": ["instance_dependency"]},
        definition,
    ) == ["instance_dependency", "hydro_initial_volume"]


def test_component_availability_uses_only_the_canonical_lifecycle_state() -> None:
    assert component_is_available({"status": "published"})
    assert component_is_available({"status": "published", "implemented": False})
    assert not component_is_available({"status": "published", "enabled": False})
    assert not component_is_available({"status": "已发布"})


def test_finalized_draft_exposes_catalog_dependencies_to_the_editor() -> None:
    draft = {
        "components": [
            {"type": "hydro_initial_volume"},
            {"type": "hydro_volume_bounds"},
        ],
        "semantic": {"sets": [], "parameters": [], "variables": []},
        "runtime_parameters": {},
        "objective": {},
    }

    finalize_model_draft(draft)

    volume_bounds = draft["components"][1]
    assert volume_bounds["depends_on"] == ["hydro_initial_volume"]
    assert volume_bounds["dependencies"] == ["hydro_initial_volume"]


def test_dependency_graph_detects_self_missing_and_cycles() -> None:
    graph = build_dependency_graph(
        [
            {"component_id": "self_component", "depends_on": ["self_component"]},
            {"component_id": "cycle_a", "depends_on": ["cycle_b"]},
            {"component_id": "cycle_b", "dependencies": ["cycle_a"]},
            {"component_id": "missing_owner", "depends_on": ["not_registered"]},
        ]
    )

    errors = selected_dependency_errors(graph, graph, known_ids=graph)
    codes = {item["error_code"] for item in errors}
    assert {"SELF_DEPENDENCY", "DEPENDENCY_NOT_FOUND", "CYCLIC_DEPENDENCY"} <= codes
    assert find_dependency_cycles(graph) == [
        ["cycle_a", "cycle_b", "cycle_a"],
        ["self_component", "self_component"],
    ]


def test_dependency_graph_marks_every_member_of_overlapping_cycles() -> None:
    graph = {
        "a": ["b", "c"],
        "b": ["d"],
        "c": ["d"],
        "d": ["a"],
    }

    cycles = find_dependency_cycles(graph)
    assert cycles == [["a", "b", "d", "a"], ["a", "c", "d", "a"]]
    assert {identifier for cycle in cycles for identifier in cycle} == {"a", "b", "c", "d"}


def test_component_definition_rejects_self_dependency() -> None:
    result = validate_component_definition(
        {
            "component_id": "self_component",
            "status": "draft",
            "metadata_only": True,
            "depends_on": ["self_component"],
            "variables": [],
            "parameters": [],
            "constraints": [],
            "objective_terms": [],
        }
    )

    assert result["valid"] is False
    assert any(item["message"] == "组件不能依赖自身" for item in result["errors"])


def test_dependency_api_rejects_unknown_component(client) -> None:
    response = client.post(
        "/api/components/validate-dependencies",
        json={"components": [{"component_id": "definitely_not_registered"}]},
    )

    assert response.status_code == 200, response.text
    assert response.json()["valid"] is False
    assert response.json()["errors"][0]["error_code"] == "UNKNOWN_COMPONENT"


def test_dependency_api_rejects_cycle(monkeypatch, client) -> None:
    monkeypatch.setattr(
        component_api,
        "get_component_catalog",
        lambda: [
            {"component_id": "cycle_a", "depends_on": ["cycle_b"]},
            {"component_id": "cycle_b", "dependencies": ["cycle_a"]},
        ],
    )

    response = client.post(
        "/api/components/validate-dependencies",
        json={"components": [{"component_id": "cycle_a"}, {"component_id": "cycle_b"}]},
    )

    assert response.status_code == 200, response.text
    assert response.json()["valid"] is False
    cycle_error = next(item for item in response.json()["errors"] if item["error_code"] == "CYCLIC_DEPENDENCY")
    assert cycle_error["cycle"] == ["cycle_a", "cycle_b", "cycle_a"]


def test_dependency_api_rejects_unavailable_selected_component(monkeypatch, client) -> None:
    monkeypatch.setattr(
        component_api,
        "get_component_catalog",
        lambda: [
            {
                "component_id": "offline_component",
                "status": "offline",
            }
        ],
    )

    response = client.post(
        "/api/components/validate-dependencies",
        json={"components": [{"component_id": "offline_component"}]},
    )

    assert response.status_code == 200, response.text
    assert response.json()["valid"] is False
    assert response.json()["errors"][0]["error_code"] == "COMPONENT_UNAVAILABLE"


def test_dependency_api_distinguishes_unavailable_dependency_from_missing_dependency(monkeypatch, client) -> None:
    monkeypatch.setattr(
        component_api,
        "get_component_catalog",
        lambda: [
            {
                "component_id": "owner",
                "status": "published",
                "depends_on": ["offline_dependency"],
            },
            {
                "component_id": "offline_dependency",
                "status": "offline",
            },
        ],
    )

    response = client.post(
        "/api/components/validate-dependencies",
        json={"components": [{"component_id": "owner"}]},
    )

    assert response.status_code == 200, response.text
    assert response.json()["valid"] is False
    assert response.json()["errors"][0]["error_code"] == "DEPENDENCY_UNAVAILABLE"


def test_component_validation_requires_dependency_to_be_published(client) -> None:
    dependency_id = "dependency_publish_gate"
    owner_id = "dependency_owner_gate"
    created = client.post(
        "/api/components/catalog",
        json={
            "component_id": dependency_id,
            "name": "dependency",
            "status": "draft",
            "parameters": [{"code": "limit", "default": 0}],
            "variables": [{"code": "x", "dimension": [], "lower_bound": 0}],
            "generated_constraints": [{"constraint_id": "limit_constraint", "expression": "x >= limit"}],
        },
    )
    assert created.status_code == 200, created.text

    owner = {
        "component_id": owner_id,
        "name": "owner",
        "status": "draft",
        "depends_on": [dependency_id],
        "parameters": [{"code": "limit", "default": 0}],
        "variables": [{"code": "x", "dimension": [], "lower_bound": 0}],
        "generated_constraints": [{"constraint_id": "owner_constraint", "expression": "x >= limit"}],
    }
    blocked = client.post(f"/api/components/{owner_id}/validate", json=owner)
    assert blocked.status_code == 200, blocked.text
    assert blocked.json()["valid"] is False
    assert any("尚未发布或已停用" in item["message"] for item in blocked.json()["errors"])

    published = client.post(f"/api/components/{dependency_id}/publish")
    assert published.status_code == 200, published.text
    validated = client.post(f"/api/components/{owner_id}/validate", json=owner)
    assert validated.status_code == 200, validated.text
    assert validated.json()["valid"] is True
