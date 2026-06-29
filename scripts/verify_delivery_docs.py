from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]

REQUIRED_SNIPPETS = {
    "README.md": [
        "React 前端迁移交付说明",
        "python scripts/verify_test_matrix.py",
        "npm run test:phase",
        "GET  /api/agent/status",
        "Agent 工作台已对齐 `/api/agent/*`",
    ],
    "OPERATION_MANUAL.md": [
        "Agent 工作台已接入",
        "/api/agent/confirm-invoke",
        "python scripts/verify_test_matrix.py",
        "npm run test:phase",
        "docs/frontend-migration-test-closure.md",
    ],
    "docs/react-frontend-delivery.md": [
        "阶段十二：完成 README、操作手册和交付说明同步",
        "npm run typecheck",
        "npm run test:phase",
        "spawn EPERM",
        "React 前端不重写求解内核",
    ],
    "docs/iteration-test-entrypoints.md": [
        "docs/frontend-migration-test-closure.md",
        "python scripts/verify_test_matrix.py",
        "npm run test:phase",
    ],
}

FORBIDDEN_SNIPPETS = {
    "README.md": [
        "Agent 本阶段只迁移页面",
    ],
    "OPERATION_MANUAL.md": [
        "调用日志占位",
        "Agent 页面是基础迁移版",
        "本次只迁移页面",
    ],
}


def main() -> int:
    failures: list[str] = []
    for relative_path, snippets in REQUIRED_SNIPPETS.items():
        path = ROOT / relative_path
        if not path.is_file():
            failures.append(f"missing file: {relative_path}")
            continue
        text = path.read_text(encoding="utf-8")
        for snippet in snippets:
            if snippet not in text:
                failures.append(f"{relative_path} missing snippet: {snippet}")

    for relative_path, snippets in FORBIDDEN_SNIPPETS.items():
        path = ROOT / relative_path
        if not path.is_file():
            continue
        text = path.read_text(encoding="utf-8")
        for snippet in snippets:
            if snippet in text:
                failures.append(f"{relative_path} still has stale snippet: {snippet}")

    if failures:
        print("DELIVERY_DOCS_FAILED")
        for failure in failures:
            print(f"- {failure}")
        return 1

    print("DELIVERY_DOCS_OK")
    print(f"- checked files: {len(REQUIRED_SNIPPETS)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
