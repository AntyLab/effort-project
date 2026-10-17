import unittest

from inventory import Inventory, OutOfStock


class ReservationAcceptance(unittest.TestCase):
    def setUp(self):
        self.inventory = Inventory()
        self.inventory.add("apple", 10)

    def test_reserve_reduces_available_but_not_count(self):
        self.inventory.reserve("order-1", "apple", 3)
        self.assertEqual(self.inventory.available("apple"), 7)
        self.assertEqual(self.inventory.count("apple"), 10)

    def test_available_for_an_unknown_sku_is_zero(self):
        self.assertEqual(self.inventory.available("pear"), 0)
        with self.assertRaises(OutOfStock):
            self.inventory.reserve("order-1", "pear", 1)

    def test_cannot_reserve_more_than_available(self):
        self.inventory.reserve("order-1", "apple", 8)
        with self.assertRaises(OutOfStock):
            self.inventory.reserve("order-2", "apple", 3)
        self.assertEqual(self.inventory.available("apple"), 2)

    def test_remove_cannot_take_reserved_units(self):
        self.inventory.reserve("order-1", "apple", 8)
        with self.assertRaises(OutOfStock):
            self.inventory.remove("apple", 3)
        self.inventory.remove("apple", 2)
        self.assertEqual(self.inventory.count("apple"), 8)
        self.assertEqual(self.inventory.available("apple"), 0)

    def test_release_returns_units(self):
        self.inventory.reserve("order-1", "apple", 4)
        self.inventory.release("order-1")
        self.assertEqual(self.inventory.available("apple"), 10)
        self.assertEqual(self.inventory.count("apple"), 10)
        with self.assertRaises(KeyError):
            self.inventory.release("order-1")

    def test_commit_ships_units(self):
        self.inventory.reserve("order-1", "apple", 4)
        self.inventory.commit("order-1")
        self.assertEqual(self.inventory.count("apple"), 6)
        self.assertEqual(self.inventory.available("apple"), 6)
        with self.assertRaises(KeyError):
            self.inventory.commit("order-1")
        with self.assertRaises(KeyError):
            self.inventory.release("order-1")

    def test_unknown_orders_raise_key_error(self):
        with self.assertRaises(KeyError):
            self.inventory.release("missing")
        with self.assertRaises(KeyError):
            self.inventory.commit("missing")

    def test_duplicate_order_ids_and_bad_quantities_are_rejected(self):
        self.inventory.reserve("order-1", "apple", 1)
        with self.assertRaises(ValueError):
            self.inventory.reserve("order-1", "apple", 1)
        for quantity in (0, -2):
            with self.subTest(quantity=quantity):
                with self.assertRaises(ValueError):
                    self.inventory.reserve("order-2", "apple", quantity)
        self.assertEqual(self.inventory.available("apple"), 9)

    def test_reservations_for_different_skus_are_independent(self):
        self.inventory.add("pear", 2)
        self.inventory.reserve("a", "apple", 10)
        self.inventory.reserve("b", "pear", 2)
        self.assertEqual(self.inventory.available("apple"), 0)
        self.assertEqual(self.inventory.available("pear"), 0)
        self.inventory.commit("a")
        self.assertEqual(self.inventory.count("apple"), 0)
        self.assertEqual(self.inventory.count("pear"), 2)
        self.inventory.release("b")
        self.assertEqual(self.inventory.available("pear"), 2)


if __name__ == "__main__":
    unittest.main()
