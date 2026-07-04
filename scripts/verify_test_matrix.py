from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


REQUIRED_FRONTEND_UNIT = [
    "DashboardPage.test.tsx",
    "ScenarioLibraryPage.test.tsx",
    "ModelCreationPage.test.tsx",
    "Step2SemanticModel.test.tsx",
    "Step3MathExpansion.test.tsx",
    "Step4RuntimeParams.test.tsx",
    "Step5ReviewPublish.test.tsx",
    "FormulaEditor.test.tsx",
    "formulaDsl.test.ts",
    "formulaParser.test.ts",
    "formulaValidator.test.ts",
    "compileFormulaToGenericSpec.test.ts",
    "modelCreationStore.test.ts",
    "validateModelDraft.test.ts",
    "ModelCenterPage.test.tsx",
    "ComponentLibraryPage.test.tsx",
    "componentDependencyPanel.test.tsx",
    "TaskCenterPage.test.tsx",
    "ResultCenterPage.test.tsx",
    "AgentWorkbenchPage.test.tsx",
    "OfficialFrontendOnly.test.tsx",
]

REQUIRED_FRONTEND_E2E = [
    "template_clone_publish_test.spec.ts",
    "generic_linear_builder_flow.spec.ts",
    "component_builder_flow.spec.ts",
    "component_create_validate_publish.spec.ts",
    "pv_storage_dispatch_flow.spec.ts",
    "cascade_hydro_dispatch_flow.spec.ts",
]

REQUIRED_BACKEND = [
    "test_formula_backend_taskbook_iteration.py",
    "test_model_creation_validation.py",
    "test_unified_model_draft.py",
    "test_component_library_production.py",
    "test_component_builder_e2e.py",
    "test_react_frontend_hosting.py",
    "test_agent_production_fixes.py",
    "test_agent_decoupling_fixes.py",
    "test_20260605_acceptance_round.py",
    "test_pv_storage_v2_acceptance.py",
    "test_component_based_hydro_model.py",
]

REQUIRED_PACKAGE_SCRIPTS = [
    "typecheck",
    "build",
    "test",
    "test:unit",
    "test:phase",
    "test:e2e",
]

REQUIRED_DOC_SNIPPETS = [
    "npm run typecheck",
    "npm run test:phase",
    "python scripts/verify_test_matrix.py",
    "AgentWorkbenchPage.test.tsx",
    "OfficialFrontendOnly.test.tsx",
]


def missing_files(base: Path, names: list[str]) -> list[str]:
    return [name for name in names if not (base / name).is_file()]


def main() -> int:
    failures: list[str] = []

    unit_dir = ROOT / "frontend" / "src" / "tests" / "unit"
    e2e_dir = ROOT / "frontend" / "src" / "tests" / "e2e"
    backend_dir = ROOT / "tests"

    for label, base, names in [
        ("frontend unit", unit_dir, REQUIRED_FRONTEND_UNIT),
        ("frontend e2e", e2e_dir, REQUIRED_FRONTEND_E2E),
        ("backend pytest", backend_dir, REQUIRED_BACKEND),
    ]:
        missing = missing_files(base, names)
        if missing:
            failures.append(f"{label} missing: {', '.join(missing)}")

    package_json = json.loads((ROOT / "frontend" / "package.json").read_text(encoding="utf-8"))
    scripts = package_json.get("scripts", {})
    missing_scripts = [name for name in REQUIRED_PACKAGE_SCRIPTS if name not in scripts]
    if missing_scripts:
        failures.append(f"package scripts missing: {', '.join(missing_scripts)}")

    entry_doc = (ROOT / "docs" / "iteration-test-entrypoints.md").read_text(encoding="utf-8")
    missing_doc = [snippet for snippet in REQUIRED_DOC_SNIPPETS if snippet not in entry_doc]
    if missing_doc:
        failures.append(f"iteration test doc missing snippets: {', '.join(missing_doc)}")

    if failures:
        print("TEST_MATRIX_FAILED")
        for failure in failures:
            print(f"- {failure}")
        return 1

    print("TEST_MATRIX_OK")
    print(f"- frontend unit files: {len(REQUIRED_FRONTEND_UNIT)}")
    print(f"- frontend e2e files: {len(REQUIRED_FRONTEND_E2E)}")
    print(f"- backend pytest files: {len(REQUIRED_BACKEND)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
