import unittest

from app.semantic.semantic_validator import RuntimeParameterValidator
from app.services.template_service import template_library


class TestParameterValidation(unittest.TestCase):
    def test_length_error_is_structured(self) -> None:
        template = template_library.get_template("economic_dispatch")
        params = template_library.sample_runtime_parameters("economic_dispatch")
        params["load_forecast"] = [1, 2]
        errors = RuntimeParameterValidator().validate(template, params)
        self.assertTrue(any(item["error"] == "length mismatch" for item in errors))
