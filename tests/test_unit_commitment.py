import unittest

from tests.test_helpers import TemplateSolveMixin


class TestUnitCommitment(TemplateSolveMixin, unittest.TestCase):
    template_code = "unit_commitment_day_ahead"
