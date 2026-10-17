import unittest

from inventory import Inventory, OutOfStock


class InventoryTest(unittest.TestCase):
    def test_add_and_remove(self):
        inventory = Inventory()
        inventory.add("apple", 5)
        inventory.remove("apple", 2)
        self.assertEqual(inventory.count("apple"), 3)
        with self.assertRaises(OutOfStock):
            inventory.remove("apple", 4)

    def test_reservation_holds_units(self):
        inventory = Inventory()
        inventory.add("apple", 5)
        inventory.reserve("order-1", "apple", 2)
        self.assertEqual(inventory.available("apple"), 3)
        self.assertEqual(inventory.count("apple"), 5)


if __name__ == "__main__":
    unittest.main()
