import unittest

from tests.test_helpers import TemplateSolveMixin


class TestChpDispatch(TemplateSolveMixin, unittest.TestCase):
    template_code = "chp_dispatch"
