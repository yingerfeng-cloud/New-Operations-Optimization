from app.services.function_asset_service import function_asset_service
from app.templates.power_templates import get_power_templates


def test_p4_demo_templates_and_function_assets_exist() -> None:
    templates = get_power_templates()
    assert "cascade_hydro_dispatch" in templates
    assert "cascade_hydro_dispatch_v1" in templates
    assert "nonlinear_hydro_power_demo" in templates
    assert templates["nonlinear_hydro_power_demo"]["problem_type"] == "NLP"
    assert templates["nonlinear_hydro_power_demo"]["solver"] == "Ipopt"

    assets = {asset.function_id: asset for asset in function_asset_service.list_assets()}
    assert assets["cascade_hydro_level_storage_v1"].function_type == "piecewise_1d"
    assert assets["cascade_hydro_tailwater_outflow_v1"].function_type == "piecewise_1d"
    assert assets["cascade_hydro_power_surface_v1"].function_type == "piecewise_2d"
    assert assets["cascade_hydro_power_surface_v1"].triangles


def test_minlp_reserved_not_marked_as_production_solver() -> None:
    templates = get_power_templates()
    assert "MINLP_RESERVED" not in {
        templates["cascade_hydro_dispatch"].get("problem_type"),
        templates["cascade_hydro_dispatch_v1"].get("problem_type"),
        templates["nonlinear_hydro_power_demo"].get("problem_type"),
    }
