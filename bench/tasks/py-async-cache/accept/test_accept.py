import asyncio
import unittest

from cache import AsyncCache


async def settle():
    # Let every runnable task advance; no wall-clock timing is involved.
    for _ in range(10):
        await asyncio.sleep(0)


class AsyncCacheAcceptance(unittest.IsolatedAsyncioTestCase):
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

    async def test_cached_values_are_reused_until_invalidated(self):
        calls = []

        async def loader(key):
            calls.append(key)
            return len(calls)

        cache = AsyncCache(loader)
        self.assertEqual(await cache.get("k"), 1)
        self.assertEqual(await cache.get("k"), 1)
        cache.invalidate("k")
        self.assertEqual(await cache.get("k"), 2)
        self.assertEqual(calls, ["k", "k"])

    async def test_different_keys_load_independently(self):
        gate = asyncio.Event()
        calls = []

        async def loader(key):
            calls.append(key)
            await gate.wait()
            return key * 2

        cache = AsyncCache(loader)
        first = asyncio.ensure_future(cache.get("a"))
        second = asyncio.ensure_future(cache.get("b"))
        await settle()
        self.assertEqual(sorted(calls), ["a", "b"])
        gate.set()
        self.assertEqual(await asyncio.gather(first, second), ["aa", "bb"])

    async def test_failures_reach_every_waiter_and_are_not_cached(self):
        gate = asyncio.Event()
        calls = []

        async def loader(key):
            calls.append(key)
            await gate.wait()
            if len(calls) == 1:
                raise RuntimeError("load failed")
            return "fresh"

        cache = AsyncCache(loader)
        waiters = [asyncio.ensure_future(cache.get("k")) for _ in range(2)]
        await settle()
        gate.set()
        results = await asyncio.gather(*waiters, return_exceptions=True)
        self.assertEqual(len(calls), 1)
        for result in results:
            self.assertIsInstance(result, RuntimeError)
            self.assertEqual(str(result), "load failed")
        self.assertEqual(await cache.get("k"), "fresh")
        self.assertEqual(len(calls), 2)

    async def test_cancelling_one_waiter_does_not_cancel_the_load(self):
        gate = asyncio.Event()
        calls = []

        async def loader(key):
            calls.append(key)
            await gate.wait()
            return 42

        cache = AsyncCache(loader)
        first = asyncio.ensure_future(cache.get("x"))
        second = asyncio.ensure_future(cache.get("x"))
        await settle()
        first.cancel()
        await settle()
        gate.set()
        self.assertEqual(await second, 42)
        with self.assertRaises(asyncio.CancelledError):
            await first
        self.assertEqual(calls, ["x"])
        self.assertEqual(await cache.get("x"), 42)
        self.assertEqual(calls, ["x"])


if __name__ == "__main__":
    unittest.main()
