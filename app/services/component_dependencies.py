"""Server-owned component bindings on the existing model/task snapshots.

The catalog authorizes a new binding. It is not the authority for an existing
binding's executable definition. Revocation is a separate, deliberate gate.
"""
from copy import deepcopy
import hashlib
import json

from fastapi import HTTPException

from app.model_components.dependency_graph import component_dependency_ids, find_dependency_cycles
from app.model_components.formula_components import load_library_component, normalize_component_payload, validate_component_definition
from app.model_components.lifecycle import component_lifecycle_status
from app.model_components.registry import component_definition, get_component_builder
from app.storage.memory_store import STORE


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode()).hexdigest()


def fail(code, message, **context):
    raise HTTPException(status_code=409, detail={"code": code, "message": message, **context})


def definition_content(definition):
    normalized = normalize_component_payload(definition)
    return {key: deepcopy(value) for key, value in normalized.items() if key not in {
        "status", "enabled", "implemented", "versions", "referenced_by", "validation_result",
        "created_at", "updated_at", "published_at", "content_hash", "change_note", "revocation",
    }}


def component_hash(definition):
    return digest(definition_content(definition))


def reference_content(reference):
    return {key: deepcopy(value) for key, value in reference.items()
            if key not in {"definition", "generated_constraints", "generated_objective_terms"}}


def component_refs(model):
    spec = model.component_spec or (model.semantic_spec or {}).get("component_spec") or {}
    return [item for item in spec.get("components") or [] if item.get("enabled", True) is not False]


def component_id(reference):
    return str(reference.get("type") or reference.get("component_id") or reference.get("code") or "")


def assert_not_revoked(identifier):
    revocation = (STORE.system_config.get("component_revocations") or {}).get(identifier)
    if revocation:
        fail("COMPONENT_REVOKED", f"组件 {identifier} 已安全撤销，禁止执行；请查看原因并更新模型。",
             component_id=identifier, revocation=deepcopy(revocation))


def catalog_definition(identifier):
    assert_not_revoked(identifier)
    definition = load_library_component(identifier)
    if definition is None:
        try:
            definition = component_definition(identifier)
        except RuntimeError:
            fail("COMPONENT_NOT_FOUND", f"组件 {identifier} 不存在。")
    if component_lifecycle_status(definition) != "published":
        fail("COMPONENT_NOT_SELECTABLE", f"组件 {identifier} 已停用或尚未发布，不能新增绑定。")
    return deepcopy(definition)


def _assert_inline(reference, definition):
    inline = reference.get("definition")
    if not inline:
        return
    normalized = normalize_component_payload(inline)
    canonical = normalize_component_payload(definition)
    for field in ("generated_constraints", "generated_objective_terms", "variables", "parameters", "sets", "depends_on", "dependencies"):
        if normalized.get(field) != canonical.get(field):
            fail("COMPONENT_DEFINITION_UNTRUSTED", f"组件 {component_id(reference)} 的客户端定义与可信修订不一致。", field=field)


def _validate_graph(assets, selected):
    graph = {identifier: component_dependency_ids(entry["definition"]) for identifier, entry in assets.items()}
    missing = {identifier: [dep for dep in deps if dep not in assets or dep not in selected]
               for identifier, deps in graph.items() if any(dep not in assets or dep not in selected for dep in deps)}
    if missing:
        fail("COMPONENT_DEPENDENCY_MISSING", "组件完整依赖清单缺少上游组件，请显式装配兼容的上游修订。", missing=missing)
    cycles = find_dependency_cycles(graph)
    if cycles:
        fail("COMPONENT_DEPENDENCY_CYCLE", "组件依赖存在循环。", cycles=cycles)


def inspect_manifest(manifest, references=None):
    """Read trusted history for repair; this never grants execution permission."""
    try:
        return _validate_manifest(manifest, references)
    except (KeyError, TypeError, ValueError, AttributeError):
        fail("COMPONENT_SNAPSHOT_CORRUPT", "组件依赖清单结构或内容已损坏。")


def validate_manifest(manifest, references=None):
    assets = inspect_manifest(manifest, references)
    for identifier in assets:
        assert_not_revoked(identifier)
    return assets


def _validate_manifest(manifest, references=None):
    if not manifest:
        if references:
            fail("COMPONENT_HISTORY_UNPINNED", "缺少可信历史组件清单；不可用当前组件库伪造历史，请创建并测试新版本。")
        return {}
    content = {key: value for key, value in manifest.items() if key != "manifest_hash"}
    if manifest.get("schema_version") != 1 or digest(content) != manifest.get("manifest_hash"):
        fail("COMPONENT_SNAPSHOT_CORRUPT", "组件依赖清单完整性校验失败。")
    assets = manifest.get("assets") or {}
    instances = manifest.get("instances") or []
    if not isinstance(assets, dict) or not isinstance(instances, list):
        fail("COMPONENT_SNAPSHOT_CORRUPT", "组件依赖清单结构已损坏。")
    for identifier, entry in assets.items():
        definition = entry.get("definition") or {}
        if (component_id(definition) != identifier or component_hash(definition) != entry.get("content_hash")
                or str(definition.get("version", "1.0.0")) != entry.get("version")
                or int(definition.get("revision") or 1) != entry.get("revision")):
            fail("COMPONENT_SNAPSHOT_CORRUPT", f"组件 {identifier} 快照校验失败。")
    if any(row.get("component_id") not in assets or digest(row.get("configuration")) != row.get("instance_hash") for row in instances):
        fail("COMPONENT_SNAPSHOT_CORRUPT", "组件实例配置或参数绑定已损坏。")
    _validate_graph(assets, {row["component_id"] for row in instances})
    if references is not None:
        expected = [{"component_id": component_id(ref), "configuration": reference_content(ref),
                     "instance_hash": digest(reference_content(ref))} for ref in references]
        if instances != expected:
            fail("COMPONENT_BINDING_CHANGED", "组件选择、配置或参数绑定与固定清单不一致，请重新测试当前内容。")
        for ref in references:
            _assert_inline(ref, assets[component_id(ref)]["definition"])
    return assets


def capture_components(model):
    references = component_refs(model)
    previous = model.component_dependencies or {}
    previous_assets = inspect_manifest(previous) if previous else {}
    if model.published_at and references and not previous:
        fail("COMPONENT_HISTORY_UNPINNED", "旧发布模型没有可信历史组件清单；保留原结果，请明确创建新版本并测试。")
    assets, instances, families = {}, [], {}
    for ref in references:
        identifier = component_id(ref)
        entry = previous_assets.get(identifier)
        definition = deepcopy(entry["definition"]) if entry else catalog_definition(identifier)
        expected_version = str(ref.get("version") or (ref.get("definition") or {}).get("version") or definition.get("version", "1.0.0"))
        if expected_version != str(definition.get("version", "1.0.0")):
            fail("COMPONENT_VERSION_CONFLICT", f"组件 {identifier} 指定版本与可信修订不一致。")
        _assert_inline(ref, definition)
        family = str(definition.get("component_family_id") or identifier)
        if family in families and families[family] != identifier:
            fail("COMPONENT_VERSION_CONFLICT", "一个模型不能同时绑定同一组件家族的不兼容修订。", family=family)
        families[family] = identifier
        # Validate against the frozen graph rather than today's asset states.
        assets[identifier] = {"component_id": identifier, "family_id": family,
            "revision": int(definition.get("revision") or 1), "version": str(definition.get("version", "1.0.0")),
            "content_hash": component_hash(definition), "definition": deepcopy(definition)}
        configuration = reference_content(ref)
        instances.append({"component_id": identifier, "configuration": configuration, "instance_hash": digest(configuration)})
    _validate_graph(assets, set(assets))
    manifest = {"schema_version": 1, "assets": assets, "instances": instances}
    manifest["manifest_hash"] = digest(manifest)
    # Only the final effective binding grants execution. Old revoked entries
    # may be read to replace them, but no direct or indirect survivor may run.
    validate_manifest(manifest, references)
    return manifest if references else {}


def prepare_model_dependencies(model):
    from app.services.function_dependencies import capture_dependencies, dependency_snapshots
    model = model.model_copy(update={"component_dependencies": capture_components(model)})
    model = model.model_copy(update={"function_dependencies": capture_dependencies(model)})
    dependency_snapshots(model, require_pinned=True)
    return model


def bound_components(model_spec, manifest):
    references = [ref for ref in model_spec.get("components") or [] if ref.get("enabled", True) is not False]
    assets = validate_manifest(manifest, references)
    return [(ref, assets[component_id(ref)]["definition"]) for ref in references]


def impact(identifier):
    with STORE.lock:
        models = sorted(model.id for model in STORE.models.values() if identifier in (model.component_dependencies.get("assets") or {})
                        or any(component_id(ref) == identifier for ref in component_refs(model)))
        tasks = sorted(task.id for task in STORE.tasks.values() if identifier in ((task.request.payload.get("_component_dependencies") or {}).get("assets") or {}))
    result = {"component_id": identifier, "model_ids": models, "task_ids": tasks}
    return {**result, "impact_hash": digest(result)}
