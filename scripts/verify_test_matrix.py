from __future__ import annotations

import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]

REQUIRED_UNIT_COVERAGE = {
    "workspace modes": ["ModelWorkspaceMode.test.ts", "ModelCreationPage.test.tsx"],
    "routing": ["ModelCenterPage.test.tsx"],
    "runtime parameters": ["Step4RuntimeParams.test.tsx", "TaskCreateContracts.test.ts"],
    "scenario safety": ["ScenarioLibraryPage.test.tsx"],
    "problem type": ["ModelBuildSummaryBar.test.tsx", "modelCreationStore.test.ts"],
}

REQUIRED_BACKEND_COVERAGE = {
    "persistence and active version resolver": ["test_runtime_persistence_and_active_versions.py"],
    "horizon": ["test_model_time_dimension_contract.py", "test_runtime_horizon_policy.py"],
    "dimension contracts": ["test_model_dimension_normalization.py", "test_model_set_reference_validation.py"],
    "hydro": ["test_hydro_p0_closure.py", "test_cascade_hydro_dispatch_v1.py", "test_component_based_hydro_model.py"],
    "PWL": ["test_hydro_pwl2d_performance.py", "test_piecewise_2d_function_assets.py", "test_piecewise_curve_components.py"],
}

REQUIRED_E2E_COVERAGE = {
    "workspace flow": ["model_creation_workbench_flow.spec.ts", "scenario_to_model_creation.spec.ts"],
    "mock production": ["p1-business-experience.spec.ts", "p2-production-quality.spec.ts"],
    "responsive": ["responsive-shell.spec.ts"],
    "real backend": ["real_backend_smoke.spec.ts", "real_production_gate.spec.ts"],
}

REQUIRED_DELIVERY_FILES = [
    ".github/workflows/ci.yml",
    ".github/workflows/e2e-real.yml",
    ".github/workflows/nightly-stability.yml",
    "package.ps1",
    "启动前后端.ps1",
    "停用前后端.ps1",
    "server.py",
    "frontend/package.json",
    "frontend/src/main.tsx",
]


def require_files(base: Path, groups: dict[str, list[str]], failures: list[str]) -> None:
    for label, names in groups.items():
        missing = [name for name in names if not (base / name).is_file()]
        if missing:
            failures.append(f"{label} missing: {', '.join(missing)}")


def require_snippets(path: Path, snippets: list[str], failures: list[str]) -> None:
    if not path.is_file():
        failures.append(f"missing file: {path.relative_to(ROOT)}")
        return
    text = path.read_text(encoding="utf-8")
    missing = [snippet for snippet in snippets if snippet not in text]
    if missing:
        failures.append(f"{path.relative_to(ROOT)} missing contracts: {', '.join(missing)}")


def main() -> int:
    failures: list[str] = []
    unit_dir = ROOT / "frontend" / "src" / "tests" / "unit"
    e2e_dir = ROOT / "frontend" / "src" / "tests" / "e2e"
    backend_dir = ROOT / "tests"

    unit_files = sorted([*unit_dir.glob("*.test.ts"), *unit_dir.glob("*.test.tsx")])
    e2e_files = sorted(e2e_dir.glob("*.spec.ts"))
    backend_files = sorted(backend_dir.glob("test_*.py"))
    if not unit_files or not e2e_files or not backend_files:
        failures.append("one or more test suites are empty")

    require_files(unit_dir, REQUIRED_UNIT_COVERAGE, failures)
    require_files(e2e_dir, REQUIRED_E2E_COVERAGE, failures)
    require_files(backend_dir, REQUIRED_BACKEND_COVERAGE, failures)

    missing_delivery = [name for name in REQUIRED_DELIVERY_FILES if not (ROOT / name).is_file()]
    if missing_delivery:
        failures.append(f"delivery files missing: {', '.join(missing_delivery)}")

    package_json = json.loads((ROOT / "frontend" / "package.json").read_text(encoding="utf-8"))
    scripts = package_json.get("scripts", {})
    for name in ["typecheck", "build", "test:unit", "test:e2e:mock", "test:e2e:real"]:
        if name not in scripts:
            failures.append(f"frontend package script missing: {name}")
    if "src/tests/unit" not in scripts.get("test:unit", ""):
        failures.append("test:unit must execute the complete unit-test directory")

    require_snippets(
        ROOT / ".github" / "workflows" / "ci.yml",
        ["npm run typecheck", "npm run build", "npm run test:unit", "python -m pytest -q", "npm run test:e2e:mock", "package.ps1", "cancel-in-progress: true"],
        failures,
    )
    require_snippets(
        ROOT / ".github" / "workflows" / "nightly-stability.yml",
        ["schedule:", "workflow_dispatch:", "for run in 1 2 3", "python -m pytest -q -m slow", "npm run test:e2e:real", "cancel-in-progress: true"],
        failures,
    )
    require_snippets(
        ROOT / ".github" / "workflows" / "e2e-real.yml",
        ["npm run test:e2e:real", "verify_e2e_environment.py"],
        failures,
    )
    require_snippets(
        ROOT / "package.ps1",
        [".github", "RequiredPackageItems", "LauncherScripts", "PACKAGE_SELF_CHECK_OK"],
        failures,
    )

    frontend_test_text = "\n".join(path.read_text(encoding="utf-8") for path in [*unit_files, *e2e_files])
    forbidden = re.findall(r"\.(?:only|skip)\s*\(", frontend_test_text)
    if forbidden:
        failures.append("frontend tests contain .only() or .skip()")

    if failures:
        print("TEST_MATRIX_FAILED")
        for failure in failures:
            print(f"- {failure}")
        return 1

    print("TEST_MATRIX_OK")
    print(f"- complete frontend unit suite: {len(unit_files)} files")
    print(f"- complete mock/real E2E inventory: {len(e2e_files)} specs")
    print(f"- complete backend pytest inventory: {len(backend_files)} files")
    print("- covered gates: workspace, persistence, active resolver, horizon, hydro, PWL, CI, packaging")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
