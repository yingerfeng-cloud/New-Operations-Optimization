import json
import pytest

from tests.review_synthetic_poc import FIXTURES, run_acceptance


@pytest.mark.slow
def test_synthetic_business_day_acceptance(client):
    report = run_acceptance(client, json.loads(FIXTURES.read_text(encoding="utf-8")))
    assert report["passed"] == report["total"] == 11
