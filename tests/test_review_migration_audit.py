from copy import deepcopy
import json
from pathlib import Path
import subprocess
import sys

from app.function_asset_content import function_asset_hash
from app.migration_audit import audit_runtime_copy


def synthetic_migration_fixture():
    asset = {"function_id": "F", "name": "Synthetic F", "revision": 1, "points": [[0, 0], [20, 20]], "solve_strategy": "segment_binary"}
    bound = {"revision": 1, "content_hash": function_asset_hash(asset), "asset": asset}
    reference = {"components": [{"type": "function_mapping_component", "function_asset_id": "F"}]}
    pinned = {"name": "Synthetic pinned", "version": "v1", "status": "published", "component_spec": reference, "function_dependencies": {"F": bound},
              "parameters": {"time_step_seconds": 900}, "ui_metadata": {"time_dimension": {"interval_minutes": 15, "delta_t": 0.25}}}
    legacy = {"name": "Synthetic unknown history", "version": "v0", "status": "published", "component_spec": reference,
              "parameters": {"time_step_seconds": 900}, "ui_metadata": {"time_dimension": {"interval_minutes": 60}}}
    task = {"request": {"model_id": "PINNED", "payload": {"component_spec": reference, "semantic_spec": reference,
        "_result_context": {"function_dependencies": {"F": bound}}, "_function_asset_snapshots": {"F": asset}}}, "result": {"objective_value": 10}}
    return {"schema_version": 7, "models": {"PINNED": pinned, "LEGACY": legacy}, "function_assets": {"F": {**asset, "revision": 2, "points": [[0, 0], [20, 40]]}},
        "tasks": {"REPLAYABLE": task, "RESULT_ONLY": {"request": {"model_id": "LEGACY", "payload": {"component_spec": reference}}, "result": {"objective_value": 10}}},
        "llm_config": {"enabled": True, "key_ciphertext": "synthetic-legacy-ciphertext", "api_key": "SYNTHETIC_PRIVATE_VALUE"},
        "skills": {"fixed_skill": {"model_id": "PINNED", "model_version": "v1"}}}


def test_inventory_keeps_valid_old_bindings_and_flags_unknown_history():
    payload = synthetic_migration_fixture()
    original = deepcopy(payload)
    report = audit_runtime_copy(payload)
    assert payload == original
    by_id = {row["model_id"]: row for row in report["models"]}
    assert by_id["PINNED"]["issues"] == []  # F2 in the library does not invalidate F1.
    assert {row["issue"] for row in by_id["LEGACY"]["issues"]} == {"missing_snapshot", "time_contract_conflict"}
    assert report["tasks"][0]["replayability"] == "recorded_inputs_available"
    assert report["tasks"][1]["replayability"] == "result_only_unknown_history"
    assert report["tasks"][1]["has_result"] is True
    assert report["llm"]["decryption_executed"] is False
    assert "SYNTHETIC_PRIVATE_VALUE" not in json.dumps(report)
    assert "synthetic-legacy-ciphertext" not in json.dumps(report)


def test_corrupt_snapshot_is_not_replaced_with_the_current_function():
    payload = synthetic_migration_fixture()
    payload["models"]["PINNED"]["function_dependencies"]["F"]["asset"]["points"][1][1] = 999
    report = audit_runtime_copy(payload)
    assert report["models"][0]["issues"][0]["issue"] == "corrupt_snapshot"
    assert payload["models"]["PINNED"]["function_dependencies"]["F"]["asset"]["points"][1][1] == 999


def test_secret_and_legacy_xor_boundaries_are_explicit():
    for ciphertext, available, expected in [("fernet:v1:synthetic", False, "fernet_secret_missing"),
        ("fernet:v1:synthetic", True, "fernet_material_present_not_decryption_verified"),
        ("old-xor-ciphertext", True, "legacy_xor_original_host_user_path_required")]:
        report = audit_runtime_copy({"llm_config": {"key_ciphertext": ciphertext}}, secret_file_present=available)
        assert report["llm"]["key_state"] == expected
        assert report["llm"]["decryption_executed"] is False


def test_cli_only_reads_input_and_does_not_initialize_the_application(tmp_path):
    source = tmp_path / "runtime-copy.json"
    source.write_text(json.dumps(synthetic_migration_fixture()))
    before = source.read_bytes()
    output = tmp_path / "inventory.json"
    ran = subprocess.run([sys.executable, "scripts/audit_review_migration.py", "--input", str(source), "--output", str(output), "--synthetic"], capture_output=True, text=True, check=True)
    assert source.read_bytes() == before
    assert json.loads(output.read_text())["synthetic_fixture"] is True
    assert json.loads(ran.stdout)["models_requiring_review"] == 1
    assert "SYNTHETIC_PRIVATE_VALUE" not in ran.stdout
    assert not (tmp_path / ".optiforge-config-secret").exists()
    isolated_import = subprocess.run([sys.executable, "-c", "import sys; import app.migration_audit; print('app.storage.memory_store' in sys.modules)"], capture_output=True, text=True, check=True)
    assert isolated_import.stdout.strip() == "False"
    refused = subprocess.run([sys.executable, "scripts/audit_review_migration.py", "--input", str(source), "--output", str(source)], capture_output=True, text=True)
    assert refused.returncode != 0
    assert source.read_bytes() == before

def test_a_result_without_a_prepared_model_is_not_claimed_replayable():
    payload = {"tasks": {"OLD": {"request": {"payload": {"horizon": 1}}, "result": {"objective_value": 10}}}}
    row = audit_runtime_copy(payload)["tasks"][0]
    assert row["has_result"] is True
    assert row["replayability"] == "result_only_unknown_history"
    assert row["issues"][0]["issue"] == "missing_prepared_model"
