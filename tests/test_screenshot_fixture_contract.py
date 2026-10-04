"""Keep screenshot fixtures on the same contract as real function assets."""
import json
import subprocess
import pytest
from pathlib import Path

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


def test_screenshot_preview_uses_the_backend_interpolation_contract():
    root = Path(__file__).resolve().parents[1]
    code = "const f = require('./scripts/capture_frontend_screenshots.js'); const input = {x:150,y:15}; process.stdout.write(JSON.stringify({asset:f.functionAsset2d,input,preview:f.previewFixture(f.functionAsset2d,input)}));"
    fixture = json.loads(subprocess.check_output(['node', '-e', code], cwd=root, text=True))
    expected = function_asset_service.preview_asset('screenshot-contract-surface', {**fixture['asset'], **fixture['input']})
    actual = fixture['preview']
    assert actual['status'] == expected['status'] == 'inside_domain'
    assert actual['z'] == pytest.approx(expected['z'])
    assert actual['triangle'] == expected['triangle']
    assert actual['lambda'] == pytest.approx(expected['lambda'])
    assert [item['code'] for item in fixture['asset']['input_schema']] == ['q_gen', 'head']
