import unittest

from tests.test_helpers import TemplateSolveMixin


class TestRenewableStorageDispatch(TemplateSolveMixin, unittest.TestCase):
    template_code = "renewable_storage_dispatch"
