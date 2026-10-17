"""In-memory stock levels."""


class OutOfStock(Exception):
    """Not enough units of a SKU."""


class Inventory:
    def __init__(self):
        self._stock = {}
        self._reservations = {}

    def add(self, sku, quantity):
        if quantity <= 0:
            raise ValueError("quantity must be positive")
        self._stock[sku] = self._stock.get(sku, 0) + quantity

    def remove(self, sku, quantity):
        if quantity <= 0:
            raise ValueError("quantity must be positive")
        if quantity > self.available(sku):
            raise OutOfStock(sku)
        self._stock[sku] = self._stock.get(sku, 0) - quantity

    def count(self, sku):
        """Units on hand."""
        return self._stock.get(sku, 0)

    def available(self, sku):
        """Units on hand that are not reserved."""
        reserved = sum(quantity for held, quantity in self._reservations.values() if held == sku)
        return self.count(sku) - reserved

    def reserve(self, order_id, sku, quantity):
        if quantity <= 0:
            raise ValueError("quantity must be positive")
        if order_id in self._reservations:
            raise ValueError(f"order {order_id!r} already has a reservation")
        if quantity > self.available(sku):
            raise OutOfStock(sku)
        self._reservations[order_id] = (sku, quantity)

    def release(self, order_id):
        del self._reservations[order_id]

    def commit(self, order_id):
        sku, quantity = self._reservations.pop(order_id)
        self._stock[sku] -= quantity
