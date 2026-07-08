# Deployment

## Native

```bash
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Native defaults:

- API: `http://localhost:8000`
- data: `data/`
- runtime store: `data/runtime_store.json`

Optional environment variables:

```bash
COPT_DATA_DIR=data
COPT_RUNTIME_STORE=data/runtime_store.json
RUNTIME_STORE_PATH=data/runtime_store.json
COPT_SOLVER_MODE=native
```

Check solver availability:

```bash
python scripts/check_nlp_solver.py || true
```

## Docker Compose

Docker Compose is the standard delivery environment for real NLP acceptance:

```bash
docker compose build
docker compose up -d
docker compose exec backend python scripts/check_nlp_solver.py
docker compose exec backend bash scripts/run_nlp_tests.sh
```

Docker defaults:

- API: `http://localhost:18000`
- container API port: `8000`
- host data directory: `docker-data/`
- container data directory: `/app/data`

Docker uses the same `app/`, `frontend/`, and `tests/` code paths. It does not introduce a second backend or a separate Ipopt service.

## Acceptance Commands

Native ordinary environment:

```bash
python -m compileall -q app tests
python scripts/check_nlp_solver.py || true
python -m pytest tests/test_nlp_environment.py tests/test_nlp_adapter.py tests/test_nonlinear_hydro_power_demo.py -q -s
python -m pytest tests/test_solver_status.py -q -s
```

Docker NLP environment:

```bash
docker compose exec backend python scripts/check_nlp_solver.py
docker compose exec backend bash scripts/run_nlp_tests.sh
```

Full checks:

```bash
python -m pytest -q
cd frontend
npm ci
npm run typecheck
npm run build
npm run test:unit
```

## Common Issues

- `ipopt_path: None`: install Ipopt and ensure the executable is on `PATH`, or use Docker Compose.
- `pyomo_ipopt_available: false`: Pyomo cannot invoke the executable; check PATH and executable permissions.
- NLP publish blocked: install Ipopt or linearize the nonlinear expression.
- MINLP blocked: remove integer variables from the nonlinear model or use McCormick/PWL linearization.
