"""Keep screenshot fixtures on the same contract as real function assets."""
import json
import subprocess
import pytest
from pathlib import Path
from fastapi import HTTPException

from app.schemas.function_asset import FunctionAsset
from app.services.function_asset_service import validate_function_asset, function_asset_service


def test_screenshot_function_fixtures_match_backend_contract():
    root = Path(__file__).resolve().parents[1]
    output = subprocess.check_output(['node', '-e', "const fixtures = require('./scripts/capture_frontend_screenshots.js'); process.stdout.write(JSON.stringify([fixtures.functionAsset, fixtures.functionAsset2d]));"], cwd=root, text=True)
    fixtures = json.loads(output)
    for fixture in fixtures:
        asset = FunctionAsset.model_validate(fixture)
        validation = validate_function_asset(asset.model_dump())
        assert validation['valid'], validation
        assert len(asset.input_schema) == (2 if asset.function_type == 'piecewise_2d' else 1)
        assert asset.output_schema['code']
    assert fixtures[1]['points'] == []
    assert fixtures[1]['points_2d']
    assert fixtures[1]['solve_strategy'] == 'triangulated_milp_exact'


@pytest.mark.parametrize('x,y,status', [
    (150, 15, 'inside_domain'),
    (100, 10, 'inside_domain'),
    (200, 20, 'inside_domain'),
    (99, 15, 'outside_domain'),
    (150, 9, 'outside_domain'),
    (201, 21, 'outside_domain'),
])
def test_screenshot_preview_uses_the_backend_interpolation_contract(x, y, status):
    root = Path(__file__).resolve().parents[1]
    code = "const f = require('./scripts/capture_frontend_screenshots.js'); const input = JSON.parse(process.argv[1]); process.stdout.write(JSON.stringify({asset:f.functionAsset2d,input,preview:f.previewFixture(f.functionAsset2d,input)}));"
    fixture = json.loads(subprocess.check_output(['node', '-e', code, json.dumps({'x': x, 'y': y})], cwd=root, text=True))
    expected = function_asset_service.preview_asset('screenshot-contract-surface', {**fixture['asset'], **fixture['input']})
    actual = fixture['preview']
    assert actual['status'] == expected['status'] == status
    assert actual['boundary_clamped'] == expected['boundary_clamped'] is False
    assert (actual['requested_x'], actual['requested_y']) == (x, y)
    if status == 'inside_domain':
        assert actual['z'] == pytest.approx(expected['z'])
        assert actual['triangle'] == expected['triangle']
        assert actual['lambda'] == pytest.approx(expected['lambda'])
        assert sum(actual['lambda']) == pytest.approx(1)
    else:
        assert 'z' not in actual
        assert 'triangle' not in actual
        assert 'lambda' not in actual
    assert [item['code'] for item in fixture['asset']['input_schema']] == ['q_gen', 'head']


@pytest.mark.parametrize('invalid_fields,error_field', [
    ({'solve_strategy': 'triangulated_lambda_lp'}, 'solve_strategy'),
    ({'points_2d': [], 'points': [[100, 10, 22], [200, 10, 42], [100, 20, 30]]}, 'points_2d'),
])
def test_invalid_screenshot_surface_cannot_be_published(invalid_fields, error_field):
    root = Path(__file__).resolve().parents[1]
    code = "process.stdout.write(JSON.stringify(require('./scripts/capture_frontend_screenshots.js').functionAsset2d));"
    asset = json.loads(subprocess.check_output(['node', '-e', code], cwd=root, text=True))
    asset.update(invalid_fields)
    asset.update(function_id='invalid-screenshot-contract-surface', status='published')
    validation = validate_function_asset(asset)
    assert not validation['valid']
    assert any(error['field'] == error_field for error in validation['errors'])
    with pytest.raises(HTTPException) as rejection:
        function_asset_service.create_asset(asset)
    assert rejection.value.status_code == 422
    assert any(error['field'] == error_field for error in rejection.value.detail['validation_errors'])
