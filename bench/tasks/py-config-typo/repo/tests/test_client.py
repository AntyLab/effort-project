import unittest

from client import retry_delays


class RetryDelaysTest(unittest.TestCase):
    def test_default_delays(self):
        self.assertEqual(retry_delays(), [1.5, 2.25, 3.375])


if __name__ == "__main__":
    unittest.main()
