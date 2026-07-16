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


def test_publish_requires_same_asset_and_current_tested_revision() -> None:
    model = _create_model()

    with pytest.raises(HTTPException) as not_tested:
        model_service.publish_model(model.id)
    assert not_tested.value.detail["code"] == "MODEL_NOT_TESTED"

    tested = model_service.run_model_test_case(model.id, {"parameters": model.parameters})
    assert tested.tested_model_id == model.id
    assert tested.tested_content_hash == tested.content_hash

    changed_payload = ModelPackage.model_validate(tested.model_dump())
    changed_payload.name = f"{tested.name}-changed"
    changed = model_service.update_model(model.id, changed_payload)
    assert changed.id == model.id
    assert changed.status == "developing"

    with pytest.raises(HTTPException) as outdated:
        model_service.publish_model(model.id)
    assert outdated.value.detail["code"] == "MODEL_TEST_OUTDATED"

    retested = model_service.run_model_test_case(model.id, {"parameters": changed.parameters})
    published = model_service.publish_model(retested.id)
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
