"""In-memory stock levels."""


class OutOfStock(Exception):
    """Not enough units of a SKU."""


class Inventory:
    def __init__(self):
        self._stock = {}

    def add(self, sku, quantity):
        if quantity <= 0:
            raise ValueError("quantity must be positive")
        self._stock[sku] = self._stock.get(sku, 0) + quantity

    def remove(self, sku, quantity):
        if quantity <= 0:
            raise ValueError("quantity must be positive")
        on_hand = self._stock.get(sku, 0)
        if quantity > on_hand:
            raise OutOfStock(sku)
        self._stock[sku] = on_hand - quantity

    def count(self, sku):
        """Units on hand."""
        return self._stock.get(sku, 0)
