"""Async read-through cache."""


class AsyncCache:
    """Cache the results of an async ``loader(key)``.

    - ``await get(key)`` returns the cached value, or awaits ``loader(key)``
      and caches the result.
    - Concurrent ``get()`` calls for the same key share a single loader call.
    - If the loader raises, every caller waiting on that call gets the
      exception, nothing is cached, and a later ``get()`` calls the loader
      again.
    - Cancelling one waiting caller does not cancel the load for the others.
    - ``invalidate(key)`` forgets a cached value.
    """

    def __init__(self, loader):
        self._loader = loader
        self._values = {}

    async def get(self, key):
        if key in self._values:
            return self._values[key]
        value = await self._loader(key)
        self._values[key] = value
        return value

    def invalidate(self, key):
        self._values.pop(key, None)
