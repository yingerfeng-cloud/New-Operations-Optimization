import unittest

from tests.test_helpers import assert_diagnosis


class TestInfeasibleDiagnosis(unittest.TestCase):
    def test_all_template_diagnoses(self) -> None:
        assert_diagnosis(self, "economic_dispatch", {"unit": ["U1"], "horizon": 1, "load_forecast": [999], "unit_max_output": {"U1": 10}})
        assert_diagnosis(self, "storage_dispatch", {"storage": ["B1"], "storage_capacity": {"B1": 10}, "initial_soc": {"B1": 20}})
        assert_diagnosis(self, "renewable_storage_dispatch", {"horizon": 1, "load_forecast": [100], "grid_export_limit": [50], "storage_capacity": {"B1": 0}})
        assert_diagnosis(self, "chp_dispatch", {"unit": ["C1"], "horizon": 1, "electric_load": [100], "heat_load": [100], "electric_max": {"C1": 10}, "heat_max": {"C1": 10}})
