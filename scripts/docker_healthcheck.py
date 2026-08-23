from __future__ import annotations

import json
import sys
from urllib.request import urlopen


def _read_json(url: str) -> dict:
    with urlopen(url, timeout=5) as response:  # noqa: S310 - fixed loopback URL
        if response.status != 200:
            raise RuntimeError(f"health endpoint returned HTTP {response.status}")
        return json.load(response)


def main() -> int:
    health = _read_json("http://127.0.0.1:8000/api/health")
    solvers = _read_json("http://127.0.0.1:8000/api/solvers/status")
    if health.get("ok") is not True:
        raise RuntimeError(f"API is unhealthy: {health}")
    if not (solvers.get("highs") or {}).get("available"):
        raise RuntimeError("HiGHS is unavailable in the container")
    if not (solvers.get("ipopt") or {}).get("available"):
        raise RuntimeError("Ipopt is unavailable in the container")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"container healthcheck failed: {exc}", file=sys.stderr)
        raise SystemExit(1)
