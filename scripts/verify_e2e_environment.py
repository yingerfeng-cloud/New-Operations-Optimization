from __future__ import annotations

import os
import tempfile
from pathlib import Path

import highspy


def main() -> None:
    runtime_path = Path(os.environ.get("RUNTIME_STORE_PATH", ""))
    if not runtime_path:
        raise SystemExit("RUNTIME_STORE_PATH must point to an isolated test store")
    temp_root = Path(tempfile.gettempdir()).resolve()
    resolved = runtime_path.resolve()
    if temp_root not in resolved.parents:
        raise SystemExit(f"Real E2E store must be temporary, got: {resolved}")
    if os.environ.get("COPT_SYNC_JOBS") != "true":
        raise SystemExit("Real E2E requires deterministic synchronous jobs")
    if os.environ.get("LLM_ENABLED", "").lower() != "false":
        raise SystemExit("Real E2E must not call an external LLM")
    if not getattr(highspy, "Highs", None):
        raise SystemExit("HiGHS is unavailable")
    print(f"Controlled Real E2E environment ready: {resolved}")


if __name__ == "__main__":
    main()
