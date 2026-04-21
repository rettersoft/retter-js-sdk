import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert'
import { RioCache } from '../src/cache'

function createMockAxios(responseFn: () => any) {
  return (async (config: any) => responseFn()) as any
}

describe('RioCache', () => {
  const baseConfig = {
    url: 'https://example.com/api',
    params: { key: 'value' },
  }

  describe('cache miss', () => {
    it('should fetch from network on first request', async () => {
      let callCount = 0
      const axiosInstance = createMockAxios(() => {
        callCount++
        return {
          status: 200,
          statusText: 'OK',
          headers: {},
          data: { result: 'fresh' },
        }
      })

      const cache = new RioCache(axiosInstance, 100, false)
      const result = await cache.getWithCache(baseConfig)

      assert.equal(callCount, 1)
      assert.deepEqual(result.data, { result: 'fresh' })
      assert.equal(result.status, 200)
    })
  })

  describe('cache hit with max-age', () => {
    it('should return cached data when within max-age', async (context) => {
      context.mock.timers.enable({ apis: ['Date'] })

      let callCount = 0
      const axiosInstance = createMockAxios(() => {
        callCount++
        return {
          status: 200,
          statusText: 'OK',
          headers: { 'cache-control': 'max-age=60' },
          data: { result: `call-${callCount}` },
        }
      })

      const cache = new RioCache(axiosInstance, 100, false)

      // First call — network fetch
      const result1 = await cache.getWithCache(baseConfig)
      assert.equal(callCount, 1)
      assert.deepEqual(result1.data, { result: 'call-1' })

      // Second call within max-age — should be cached
      context.mock.timers.tick(10000) // 10s
      const result2 = await cache.getWithCache(baseConfig)
      assert.equal(callCount, 1) // no new network call
      assert.deepEqual(result2.data, { result: 'call-1' })
    })

    it('should re-fetch after max-age expires', async (context) => {
      context.mock.timers.enable({ apis: ['Date'] })

      let callCount = 0
      const axiosInstance = createMockAxios(() => {
        callCount++
        return {
          status: 200,
          statusText: 'OK',
          headers: { 'cache-control': 'max-age=30' },
          data: { result: `call-${callCount}` },
        }
      })

      const cache = new RioCache(axiosInstance, 100, false)

      await cache.getWithCache(baseConfig)
      assert.equal(callCount, 1)

      // Advance past max-age
      context.mock.timers.tick(31000)
      const result2 = await cache.getWithCache(baseConfig)
      assert.equal(callCount, 2)
      assert.deepEqual(result2.data, { result: 'call-2' })
    })
  })

  describe('no caching without cache-control', () => {
    it('should not cache when no cache-control header', async () => {
      let callCount = 0
      const axiosInstance = createMockAxios(() => {
        callCount++
        return {
          status: 200,
          statusText: 'OK',
          headers: {},
          data: { result: `call-${callCount}` },
        }
      })

      const cache = new RioCache(axiosInstance, 100, false)

      await cache.getWithCache(baseConfig)
      const result2 = await cache.getWithCache(baseConfig)

      assert.equal(callCount, 2)
      assert.deepEqual(result2.data, { result: 'call-2' })
    })
  })

  describe('Age header', () => {
    it('should reduce freshness by Age header value', async (context) => {
      context.mock.timers.enable({ apis: ['Date'] })

      let callCount = 0
      const axiosInstance = createMockAxios(() => {
        callCount++
        return {
          status: 200,
          statusText: 'OK',
          headers: { 'cache-control': 'max-age=60', 'age': '50' },
          data: { result: `call-${callCount}` },
        }
      })

      const cache = new RioCache(axiosInstance, 100, false)

      await cache.getWithCache(baseConfig)
      assert.equal(callCount, 1)

      // 10s remaining freshness (60 - 50), advance 11s
      context.mock.timers.tick(11000)
      await cache.getWithCache(baseConfig)
      assert.equal(callCount, 2) // cache expired, re-fetched
    })
  })

  describe('LRU eviction', () => {
    it('should evict oldest entry when max entries reached', async () => {
      let callCount = 0
      const axiosInstance = createMockAxios(() => {
        callCount++
        return {
          status: 200,
          statusText: 'OK',
          headers: { 'cache-control': 'max-age=3600' },
          data: { result: `call-${callCount}` },
        }
      })

      // Max 2 entries
      const cache = new RioCache(axiosInstance, 2, false)

      // Fill cache with 2 entries
      await cache.getWithCache({ url: 'https://example.com/1', params: {} })
      await cache.getWithCache({ url: 'https://example.com/2', params: {} })
      assert.equal(callCount, 2)

      // Third entry should evict the first
      await cache.getWithCache({ url: 'https://example.com/3', params: {} })
      assert.equal(callCount, 3)

      // First entry was evicted — should re-fetch (evicts entry 2 to make room)
      await cache.getWithCache({ url: 'https://example.com/1', params: {} })
      assert.equal(callCount, 4)

      // Third entry should still be cached (was not evicted)
      await cache.getWithCache({ url: 'https://example.com/3', params: {} })
      assert.equal(callCount, 4) // no new call

      // Second entry was evicted when entry 1 was re-added — should re-fetch
      await cache.getWithCache({ url: 'https://example.com/2', params: {} })
      assert.equal(callCount, 5)
    })
  })

  describe('request deduplication', () => {
    it('should deduplicate concurrent identical requests', async () => {
      let callCount = 0
      let resolveRequest: ((value: any) => void) | undefined

      const axiosInstance = (async () => {
        callCount++
        return new Promise(resolve => {
          resolveRequest = resolve
        })
      }) as any

      const cache = new RioCache(axiosInstance, 100, false)

      // Fire two concurrent requests
      const p1 = cache.getWithCache(baseConfig)
      const p2 = cache.getWithCache(baseConfig)

      // Resolve the single network request
      resolveRequest!({
        status: 200,
        statusText: 'OK',
        headers: {},
        data: { result: 'shared' },
      })

      const [r1, r2] = await Promise.all([p1, p2])

      assert.equal(callCount, 1) // only one network call
      assert.deepEqual(r1.data, { result: 'shared' })
      assert.deepEqual(r2.data, { result: 'shared' })
    })
  })

  describe('missing url', () => {
    it('should throw when url is missing', async () => {
      const axiosInstance = createMockAxios(() => ({}))
      const cache = new RioCache(axiosInstance, 100, false)

      await assert.rejects(
        () => cache.getWithCache({ params: {} } as any),
        { message: 'Missing url' }
      )
    })
  })

  describe('response shape', () => {
    it('should return only status, statusText, headers, data', async () => {
      const axiosInstance = createMockAxios(() => ({
        status: 201,
        statusText: 'Created',
        headers: { 'x-custom': 'val' },
        data: { id: 1 },
        config: { shouldBeStripped: true },
        request: { shouldBeStripped: true },
      }))

      const cache = new RioCache(axiosInstance, 100, false)
      const result = await cache.getWithCache(baseConfig)

      assert.equal(result.status, 201)
      assert.equal(result.statusText, 'Created')
      assert.deepEqual(result.headers, { 'x-custom': 'val' })
      assert.deepEqual(result.data, { id: 1 })
      assert.equal((result as any).config, undefined)
      assert.equal((result as any).request, undefined)
    })
  })
})
