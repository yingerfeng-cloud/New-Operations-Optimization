# Engineering Map

This file is the first stop for future iterations. It lists the narrow entry points that usually matter, so changes do not require rediscovering the whole repository.

## Model Creation And Drafts

- Model draft assembly: `app/model_draft.py`
- Problem type diagnosis: `app/problem_type_diagnosis.py`
- Model asset create/publish flow: `app/services/model_service.py`
- Model API router: `app/api/models.py`

When changing component-based model creation, inspect `create_model_draft_from_template`, `build_component_spec_from_draft`, and the publish path in `ModelService` before changing lower-level builders.

## Component Library

- Runtime component store: `app/storage/memory_store.py`
- Dynamic formula components: `app/model_components/formula_components.py`
- Built-in component registry: `app/model_components/registry.py`
- Default seeded library components: `app/services/model_service.py` (`_default_library_components`)
- Component API router: `app/api/components.py`

For library component references, the important invariant is: a draft component with only `{"type": component_id}` must resolve the stored component definition before diagnosis, build, and publish validation.

## Pyomo Build And Solve

- Build dispatcher: `app/builders/pyomo_builder.py`
- Component model builder: `app/builders/component_model_builder.py`
- Weighted objective compiler: `app/model_components/objective_components.py`
- HiGHS adapter: `app/solvers/highs_adapter.py`
- Runtime parameter validation: `app/semantic/semantic_validator.py`

For objective bugs, check `build_weighted_objective` first, then confirm the template/component objective terms are `solve_active` and `supported_by_backend`.

## Power Templates

- Template registry: `app/templates/power_templates.py`
- Template service: `app/services/template_service.py`
- Business result formatter: `app/explain/result_formatter.py`

Current PV-storage templates:

- `pv_storage_capacity_planning`
- `pv_storage_day_ahead_dispatch`
- `pv_storage_intraday_dispatch`

## Frontend Prototype

- Main prototype shell: `prototype.html`
- Problem type diagnosis frontend module: `static/js/problem_type_diagnosis.js`
- Frontend static regression tests: `tests/test_component_builder_frontend_static.py`

Keep new frontend logic out of `prototype.html` when it has a clear domain boundary. Prefer adding a file under `static/js/` and referencing it from the prototype.

## Local Run Scripts

- Local start script: `Run.ps1`
- Local stop script: `Shutdown.ps1`
- Compatibility app selector: `server.py`

`Run.ps1 -Full -Restart` is the canonical local full-stack command. It starts platform API, Agent API, and the static frontend server with shared `data/runtime_store.json` persistence.

## Agent Layer

- Orchestrator: `app/agent/orchestrator.py`
- Skill routing: `app/agent/skill_router.py`
- Parameter extraction: `app/agent/parameter_extractor.py`
- Platform client: `app/agent/platform_client.py`
- Skill service: `app/services/agent_skill_service.py`

Agent tests can be order-sensitive because they share runtime store state. Prefer preserving conversation-local state and avoiding global mutation in tests.
