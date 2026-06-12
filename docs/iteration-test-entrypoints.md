# Iteration Test Entrypoints

Use these focused commands during iteration. Run the full suite once before handoff.

## Problem Type And Component Library

```powershell
python -m pytest tests\test_problem_type_diagnosis.py tests\test_component_library_production.py -q
```

Use this after changing draft diagnosis, component registry resolution, component publish validation, or indexed parameter defaults.

## Component Builder And Pyomo Solve

```powershell
python -m pytest tests\test_component_builder_e2e.py tests\test_component_based_hydro_model.py -q
```

Use this after changing `ComponentModelBuilder`, dynamic formula compilation, or weighted objectives.

## PV Storage

```powershell
python -m pytest tests\test_pv_storage_objectives.py -q
```

Use this after changing PV-storage templates, objective terms, result metrics, or capacity/dispatch behavior.

## Frontend Prototype Static Checks

```powershell
python -m pytest tests\test_component_builder_frontend_static.py -q
```

Use this after changing `prototype.html` or files under `static/js/`.

## Agent Flow

```powershell
python -m pytest tests\test_agent_production_fixes.py tests\test_agent_decoupling_fixes.py -q
```

Use this after changing conversation state, default confirmation, skill routing, or parameter extraction.

## Full Handoff Gate

```powershell
python -m pytest -q
```

Expected runtime in the current local environment is roughly 80-120 seconds. If this fails but the focused group passes, inspect order-dependent runtime store state before widening the code change.

