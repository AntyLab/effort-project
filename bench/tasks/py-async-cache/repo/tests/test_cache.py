import asyncio
import unittest

from cache import AsyncCache


async def settle():
    for _ in range(5):
        await asyncio.sleep(0)


class AsyncCacheTest(unittest.IsolatedAsyncioTestCase):
    async def test_caches_values(self):
        calls = []

        async def loader(key):
            calls.append(key)
            return key * 2

        cache = AsyncCache(loader)
        self.assertEqual(await cache.get("a"), "aa")
        self.assertEqual(await cache.get("a"), "aa")
        self.assertEqual(calls, ["a"])

    async def test_concurrent_gets_share_one_load(self):
        gate = asyncio.Event()
        calls = []

        async def loader(key):
            calls.append(key)
            await gate.wait()
            return key.upper()

        cache = AsyncCache(loader)
        waiters = [asyncio.ensure_future(cache.get("a")) for _ in range(3)]
        await settle()
        gate.set()
        self.assertEqual(await asyncio.gather(*waiters), ["A", "A", "A"])
        self.assertEqual(calls, ["a"])


if __name__ == "__main__":
    unittest.main()
