from __future__ import annotations

from copy import deepcopy

import pytest
from fastapi import HTTPException

from app.schemas.model import ModelPackage
from app.services.model_service import model_service
from app.storage.memory_store import STORE
from tests.test_model_skill_invocation import minimal_dispatch_payload


def _create_model(*, version: str = "v1.0"):
    payload = minimal_dispatch_payload()
    payload["version"] = version
    return model_service.create_model(ModelPackage.model_validate(payload))


def test_new_model_status_is_system_managed_and_always_starts_developing() -> None:
    payload = minimal_dispatch_payload()
    payload.update({
        "status": "published",
        "is_active_version": True,
        "published_at": "2026-07-30 10:00:00",
        "tested_at": "2026-07-30 09:00:00",
        "tested_content_hash": "forged",
        "tested_model_id": payload["id"],
    })

    created = model_service.create_model(ModelPackage.model_validate(payload))

    assert created.status == "developing"
    assert created.is_active_version is False
    assert created.published_at is None
    assert created.tested_at is None
    assert created.tested_content_hash is None
    assert created.tested_model_id is None


def test_publish_requires_current_trial_revision_and_trial_is_immutable() -> None:
    model = _create_model()

    with pytest.raises(HTTPException) as not_tested:
        model_service.publish_model(model.id)
    assert not_tested.value.detail["code"] == "MODEL_NOT_TESTED"

    tested = model_service.run_model_test_case(model.id, {"parameters": model.parameters})
    assert tested.status == "trial"
    assert tested.tested_model_id == model.id
    assert tested.tested_content_hash == tested.content_hash

    changed_payload = ModelPackage.model_validate(tested.model_dump())
    changed_payload.name = f"{tested.name}-changed"
    with pytest.raises(HTTPException) as immutable:
        model_service.update_model(model.id, changed_payload)
    assert immutable.value.status_code == 409

    published = model_service.publish_model(tested.id)
    assert published.id == model.id
    assert published.status == "published"


def test_publish_rejects_test_record_from_different_asset() -> None:
    model = _create_model()
    tested = model_service.run_model_test_case(model.id, {"parameters": model.parameters})
    mismatched = tested.model_copy(update={"tested_model_id": "MODEL-OTHER"})
    with STORE.lock:
        STORE.models[model.id] = mismatched

    with pytest.raises(HTTPException) as mismatch:
        model_service.publish_model(model.id)
    assert mismatch.value.detail["code"] == "MODEL_TEST_MISMATCH"


def test_published_validation_preserves_status_and_offline_version_can_be_republished() -> None:
    model = _create_model()
    tested = model_service.run_model_test_case(model.id, {"parameters": model.parameters})
    published = model_service.publish_model(tested.id)

    validated = model_service.run_model_test_case(published.id, {"parameters": published.parameters})
    assert validated.status == "published"
    assert validated.tested_content_hash == validated.content_hash

    offline = model_service.offline_model(validated.id)
    assert offline.status == "offline"

    republished = model_service.publish_model(offline.id)
    assert republished.status == "published"


def test_trial_model_can_be_tested_and_promoted_to_formal_publication() -> None:
    model = _create_model()
    with STORE.lock:
        STORE.models[model.id] = model.model_copy(update={"status": "trial"})

    tested = model_service.run_model_test_case(model.id, {"parameters": model.parameters})
    assert tested.status == "trial"

    published = model_service.publish_model(tested.id)
    assert published.status == "published"


def test_unpublished_trial_can_return_to_draft_and_clears_test_evidence() -> None:
    model = _create_model()
    tested = model_service.run_model_test_case(model.id, {"parameters": model.parameters})

    draft = model_service.return_model_to_draft(tested.id)

    assert draft.status == "developing"
    assert draft.published_at is None
    assert draft.tested_at is None
    assert draft.tested_model_id is None
    assert draft.tested_content_hash is None

    changed_payload = ModelPackage.model_validate(draft.model_dump())
    changed_payload.name = f"{draft.name}-changed"
    changed = model_service.update_model(draft.id, changed_payload)
    assert changed.name.endswith("-changed")


def test_previously_published_trial_cannot_return_to_draft() -> None:
    model = _create_model()
    tested = model_service.run_model_test_case(model.id, {"parameters": model.parameters})
    published = model_service.publish_model(tested.id)
    offline = model_service.offline_model(published.id)
    retrial = model_service.run_model_test_case(offline.id, {"parameters": offline.parameters})

    with pytest.raises(HTTPException) as immutable:
        model_service.return_model_to_draft(retrial.id)

    assert immutable.value.detail["code"] == "PUBLISHED_HISTORY_IMMUTABLE"


def test_offline_is_restricted_to_online_models_and_published_history_is_immutable() -> None:
    developing = _create_model()
    with pytest.raises(HTTPException) as invalid_transition:
        model_service.offline_model(developing.id)
    assert invalid_transition.value.detail["code"] == "INVALID_MODEL_STATUS_TRANSITION"

    tested = model_service.run_model_test_case(developing.id, {"parameters": developing.parameters})
    with pytest.raises(HTTPException) as trial_transition:
        model_service.offline_model(tested.id)
    assert trial_transition.value.detail["code"] == "INVALID_MODEL_STATUS_TRANSITION"

    published = model_service.publish_model(tested.id)
    offline = model_service.offline_model(published.id)
    changed_payload = ModelPackage.model_validate(offline.model_dump())
    changed_payload.name = f"{offline.name}-changed"

    with pytest.raises(HTTPException) as immutable:
        model_service.update_model(offline.id, changed_payload)
    assert immutable.value.status_code == 409


def test_versions_use_family_maximum_and_reject_duplicate_family_version() -> None:
    source = _create_model(version="v1.0")
    first = model_service.create_model_version(source.id, {"name": "family v1.1"})
    second = model_service.create_model_version(source.id, {"name": "family v1.2"})

    assert first.version == "v1.1"
    assert second.version == "v1.2"

    duplicate = ModelPackage.model_validate(deepcopy(second.model_dump()))
    duplicate.id = None
    duplicate.name = "duplicate family version"
    with pytest.raises(HTTPException) as conflict:
        model_service.create_model(duplicate)
    assert conflict.value.detail["code"] == "MODEL_VERSION_CONFLICT"


def test_publish_persists_formula_published_revision_without_losing_applied_baseline() -> None:
    payload = minimal_dispatch_payload()
    payload["model_draft"] = {
        "formulas": [{
            "formula_id": "versioned-objective",
            "name": "versioned-objective",
            "kind": "objective",
            "dsl_formula": "dispatch",
            "version_state": {
                "current_revision": 2,
                "last_saved_revision": 2,
                "last_compiled_revision": 2,
                "applied_revision": 2,
                "expression_hash": "fnv1a-current",
                "compiled_expression_hash": "fnv1a-current",
                "compiler_version": "2.0.0",
            },
            "applied_version": {"revision": 2, "expression_hash": "fnv1a-current", "expression": "dispatch"},
        }]
    }
    model = model_service.create_model(ModelPackage.model_validate(payload))
    tested = model_service.run_model_test_case(model.id, {"parameters": model.parameters})
    published = model_service.publish_model(tested.id)
    formula = published.model_draft["formulas"][0]
    assert formula["version_state"]["applied_revision"] == 2
    assert formula["version_state"]["published_revision"] == 2
    assert formula["published_version"]["revision"] == 2
    assert published.ui_metadata["formula_versions"]["versioned-objective"]["published_revision"] == 2
