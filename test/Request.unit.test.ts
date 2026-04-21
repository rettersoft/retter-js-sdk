import { describe, it, mock } from 'node:test'
import assert from 'node:assert'
import axios from 'axios'
import Request from '../src/Request'
import { RetterRegion } from '../src/types'
import { base64Encode, sort } from '../src/helpers'

function mockAxiosCreate(handler: (config: any) => any) {
  mock.method(axios, 'create', () => handler)
}

describe('Request', () => {
  describe('URL building', () => {
    it('should build URL with default region (euWest1)', async () => {
      let capturedConfig: any
      mockAxiosCreate((config: any) => {
        capturedConfig = config
        return { status: 200, statusText: 'OK', headers: {}, data: {} }
      })

      const request = new Request({ projectId: 'myproject' })
      await request.call('myproject', 'INSTANCE/MyClass', { method: 'post', params: {} })

      assert.ok(capturedConfig.url.includes('myproject.api.retter.io'))
      assert.ok(capturedConfig.url.includes('/myproject/INSTANCE/MyClass'))
    })

    it('should build URL with euWest1Beta region', async () => {
      let capturedConfig: any
      mockAxiosCreate((config: any) => {
        capturedConfig = config
        return { status: 200, statusText: 'OK', headers: {}, data: {} }
      })

      const request = new Request({ projectId: 'myproject', region: RetterRegion.euWest1Beta })
      await request.call('myproject', 'INSTANCE/MyClass', { method: 'post', params: {} })

      assert.ok(capturedConfig.url.includes('myproject.test-api.retter.io'))
    })

    it('should use custom URL when provided', async () => {
      let capturedConfig: any
      mockAxiosCreate((config: any) => {
        capturedConfig = config
        return { status: 200, statusText: 'OK', headers: {}, data: {} }
      })

      const request = new Request({ projectId: 'myproject', url: 'custom.api.example.com' })
      await request.call('myproject', 'INSTANCE/MyClass', { method: 'post', params: {} })

      assert.ok(capturedConfig.url.startsWith('https://custom.api.example.com/myproject/'))
    })

    it('should strip leading slash from path', async () => {
      let capturedConfig: any
      mockAxiosCreate((config: any) => {
        capturedConfig = config
        return { status: 200, statusText: 'OK', headers: {}, data: {} }
      })

      const request = new Request({ projectId: 'p1' })
      await request.call('p1', '/TOKEN/auth', { method: 'post', params: {} })

      // Should not have double slash
      assert.ok(!capturedConfig.url.includes('//TOKEN'))
      assert.ok(capturedConfig.url.includes('/TOKEN/auth'))
    })
  })

  describe('query parameters', () => {
    it('should pass through __culture and __platform from config', async () => {
      let capturedConfig: any
      mockAxiosCreate((config: any) => {
        capturedConfig = config
        return { status: 200, statusText: 'OK', headers: {}, data: {} }
      })

      const request = new Request({ projectId: 'p1', culture: 'tr-TR', platform: 'web' })
      await request.call('p1', 'TEST', { method: 'post', params: {} })

      assert.equal(capturedConfig.params.__culture, 'tr-TR')
      assert.equal(capturedConfig.params.__platform, 'web')
    })

    it('should not override existing __culture and __platform in params', async () => {
      let capturedConfig: any
      mockAxiosCreate((config: any) => {
        capturedConfig = config
        return { status: 200, statusText: 'OK', headers: {}, data: {} }
      })

      const request = new Request({ projectId: 'p1', culture: 'tr-TR', platform: 'web' })
      await request.call('p1', 'TEST', {
        method: 'post',
        params: { __culture: 'en-US', __platform: 'node' },
      })

      assert.equal(capturedConfig.params.__culture, 'en-US')
      assert.equal(capturedConfig.params.__platform, 'node')
    })
  })

  describe('GET base64 encoding', () => {
    it('should base64-encode body data for GET requests', async () => {
      let capturedConfig: any
      mockAxiosCreate((config: any) => {
        capturedConfig = config
        return { status: 200, statusText: 'OK', headers: {}, data: {} }
      })

      const body = { name: 'test', value: 42 }
      const request = new Request({ projectId: 'p1' })
      await request.call('p1', 'TEST', {
        method: 'get',
        params: {},
        data: body,
        base64Encode: true,
      })

      const expected = base64Encode(JSON.stringify(sort(body)))
      assert.equal(capturedConfig.params.data, expected)
      assert.equal(capturedConfig.params.__isbase64, true)
      assert.equal(capturedConfig.data, undefined) // body removed
    })

    it('should skip base64 encoding when base64Encode is false', async () => {
      let capturedConfig: any
      mockAxiosCreate((config: any) => {
        capturedConfig = config
        return { status: 200, statusText: 'OK', headers: {}, data: {} }
      })

      const body = { name: 'test' }
      const request = new Request({ projectId: 'p1' })
      await request.call('p1', 'TEST', {
        method: 'get',
        params: {},
        data: body,
        base64Encode: false,
      })

      assert.equal(capturedConfig.params.data, undefined)
      assert.equal(capturedConfig.params.__isbase64, undefined)
      assert.deepEqual(capturedConfig.data, body) // body kept as-is
    })

    it('should not base64-encode for POST requests', async () => {
      let capturedConfig: any
      mockAxiosCreate((config: any) => {
        capturedConfig = config
        return { status: 200, statusText: 'OK', headers: {}, data: {} }
      })

      const body = { name: 'test' }
      const request = new Request({ projectId: 'p1' })
      await request.call('p1', 'TEST', {
        method: 'post',
        params: {},
        data: body,
        base64Encode: true,
      })

      assert.equal(capturedConfig.params.data, undefined)
      assert.deepEqual(capturedConfig.data, body)
    })
  })

  describe('cache integration', () => {
    it('should use cache for GET when memoryCache enabled', async () => {
      let callCount = 0
      mockAxiosCreate((config: any) => {
        callCount++
        return {
          status: 200,
          statusText: 'OK',
          headers: { 'cache-control': 'max-age=60' },
          data: { count: callCount },
        }
      })

      const request = new Request({
        projectId: 'p1',
        memoryCache: { enabled: true },
      })

      const r1 = await request.call('p1', 'TEST', { method: 'get', params: {} })
      const r2 = await request.call('p1', 'TEST', { method: 'get', params: {} })

      assert.equal(callCount, 1) // second call served from cache
      assert.deepEqual(r1.data, { count: 1 })
      assert.deepEqual(r2.data, { count: 1 })
    })

    it('should not use cache for POST even when memoryCache enabled', async () => {
      let callCount = 0
      mockAxiosCreate((config: any) => {
        callCount++
        return {
          status: 200,
          statusText: 'OK',
          headers: { 'cache-control': 'max-age=60' },
          data: { count: callCount },
        }
      })

      const request = new Request({
        projectId: 'p1',
        memoryCache: { enabled: true },
      })

      await request.call('p1', 'TEST', { method: 'post', params: {}, data: {} })
      await request.call('p1', 'TEST', { method: 'post', params: {}, data: {} })

      assert.equal(callCount, 2) // both calls hit network
    })
  })

  describe('error propagation', () => {
    it('should propagate errors from axios', async () => {
      mockAxiosCreate(() => {
        throw { response: { status: 500, data: 'Server Error' } }
      })

      const request = new Request({ projectId: 'p1' })

      await assert.rejects(
        () => request.call('p1', 'TEST', { method: 'post', params: {} }),
      )
    })
  })
})
