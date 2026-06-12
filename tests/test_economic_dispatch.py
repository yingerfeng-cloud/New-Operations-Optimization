import unittest

from tests.test_helpers import TemplateSolveMixin


class TestEconomicDispatch(TemplateSolveMixin, unittest.TestCase):
    template_code = "economic_dispatch"
