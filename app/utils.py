from __future__ import annotations

from datetime import datetime
import os


def now_text() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def has_highspy() -> bool:
    try:
        import highspy  # noqa: F401

        return True
    except Exception:
        return False


def has_pyomo() -> bool:
    try:
        import pyomo.environ  # noqa: F401

        return True
    except Exception:
        return False


def require_pyomo_for_publish() -> bool:
    return os.getenv("REQUIRE_PYOMO_FOR_PUBLISH", "false").strip().lower() in {"1", "true", "yes", "on"}
