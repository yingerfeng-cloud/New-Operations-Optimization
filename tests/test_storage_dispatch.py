import unittest

from tests.test_helpers import TemplateSolveMixin


class TestStorageDispatch(TemplateSolveMixin, unittest.TestCase):
    template_code = "storage_dispatch"
