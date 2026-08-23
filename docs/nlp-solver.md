# NLP Solver Support

The platform supports continuous-variable NLP models through Pyomo + Ipopt.
LP, MILP, QP, and MIQP models continue to use HiGHS.

## Requirements

- `pyomo`
- `highspy`
- an `ipopt` executable on `PATH`

Installing only `cyipopt` is not enough for this platform path. Pyomo must be able to resolve:

```bash
python scripts/check_nlp_solver.py
```

The check must report:

```text
ipopt_available: true
pyomo_ipopt_available: true
status: OK
```

## Native Runtime

Native startup is unchanged:

```bash
pip install -r requirements.txt
uvicorn app.main:app --reload
python scripts/check_nlp_solver.py
```

If Ipopt is missing, LP/MILP remains available through HiGHS. NLP solve or publish paths return a clear error instead of pretending to solve.

## Docker Runtime

Docker Compose provides the standard reproducible environment with Ipopt installed:

```bash
docker compose build
docker compose up -d
docker compose exec backend python scripts/check_nlp_solver.py
docker compose exec backend bash scripts/run_nlp_tests.sh
```

Docker maps `localhost:18000` to the backend container and stores runtime data in `./docker-data`.
Native runtime continues to use `localhost:8000` and `data/`.

The runtime base image is pulled from Mamba's official GitHub Container
Registry (`ghcr.io/mamba-org/micromamba`) and pinned by digest. Python, Node.js,
HiGHS, and Ipopt are then installed from conda-forge inside that image. This
avoids a runtime dependency on Docker Hub while keeping both Apple Silicon and
Linux delivery reproducible.

## Solver Status API

The frontend and operational checks use:

```text
GET /api/solvers/status
```

The response reports HiGHS and Ipopt independently. Ipopt unavailability never makes the status API return 500 and does not affect HiGHS status.

## Result Semantics

Ipopt is a local NLP solver. NLP results include `local_optimum_warning: true`.
The platform reports solver status and local-optimum risk; it does not claim global optimality for NLP.

NLP task options can be supplied through `solver_config`:

```json
{
  "solver": "Ipopt",
  "time_limit_seconds": 300,
  "solver_config": {
    "nlp_tolerance": 1e-7,
    "acceptable_tol": 1e-5,
    "max_iter": 500
  }
}
```

`time_limit_seconds` maps to Ipopt's `max_cpu_time`. When no NLP tolerance is
provided, the adapter uses `1e-6`; the MILP-only `mip_gap` setting is not reused
as an NLP convergence tolerance.

MINLP remains `MINLP_RESERVED`. Models that combine nonlinear expressions with binary or integer variables are blocked unless they are reformulated with McCormick, 1D PWL, or 2D PWL linearization.
