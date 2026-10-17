"""Isolated real-solver browser fixture with deterministic 35-second latency.

Never used by app.main, Docker's default command, or production deployments.
Only review_slow_* models receive the delay; their final answer is solved by HiGHS.
"""
import os
from pathlib import Path
import tempfile
import time

runtime_path = Path(os.environ.get("OPTIFORGE_RUNTIME_STORE") or os.environ["RUNTIME_STORE_PATH"]).resolve()
if not runtime_path.is_relative_to(Path(tempfile.gettempdir()).resolve()):
    raise RuntimeError("Browser review must use a temporary runtime store")

from app.main import app  # noqa: E402
from app.builders.pyomo_builder import PyomoModelBuilder  # noqa: E402
from app.solvers.solver_router import solver_router  # noqa: E402

original_build = PyomoModelBuilder.build
original_solve = solver_router.solve


def build(self, template, parameters):
    model, context = original_build(self, template, parameters)
    if str(template.get("model_code") or "").startswith("review_slow_"):
        model._review_delay_seconds = 35
    return model, context


def solve(model, **options):
    if getattr(model, "_review_delay_seconds", 0):
        time.sleep(model._review_delay_seconds)
    return original_solve(model, **options)


PyomoModelBuilder.build = build
solver_router.solve = solve

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", "8000")))
