import { describe, it } from 'node:test'
import assert from 'node:assert'
import { getRuntime, base64Encode, sort } from '../src/helpers'
import { Runtime } from '../src/types'

describe('helpers', () => {
  describe('getRuntime', () => {
    it('should return node when document is not defined', () => {
      assert.equal(getRuntime(), Runtime.node)
    })
  })

  describe('base64Encode', () => {
    it('should encode a simple string', () => {
      assert.equal(base64Encode('hello'), Buffer.from('hello').toString('base64'))
    })

    it('should encode an empty string', () => {
      assert.equal(base64Encode(''), '')
    })

    it('should encode a JSON string', () => {
      const json = JSON.stringify({ key: 'value' })
      assert.equal(base64Encode(json), Buffer.from(json).toString('base64'))
    })

    it('should encode unicode characters', () => {
      const str = 'héllo wörld'
      assert.equal(base64Encode(str), Buffer.from(str).toString('base64'))
    })
  })

  describe('sort', () => {
    it('should return null for null input', () => {
      assert.equal(sort(null), null)
    })

    it('should return undefined for undefined input', () => {
      assert.equal(sort(undefined), undefined)
    })

    it('should return primitives as-is', () => {
      assert.equal(sort(42), 42)
      assert.equal(sort('hello'), 'hello')
      assert.equal(sort(true), true)
    })

    it('should sort object keys alphabetically', () => {
      const input = { c: 3, a: 1, b: 2 }
      const result = sort(input)
      assert.deepEqual(Object.keys(result), ['a', 'b', 'c'])
      assert.deepEqual(result, { a: 1, b: 2, c: 3 })
    })

    it('should sort nested object keys', () => {
      const input = { z: { b: 2, a: 1 }, a: { d: 4, c: 3 } }
      const result = sort(input)
      assert.deepEqual(Object.keys(result), ['a', 'z'])
      assert.deepEqual(Object.keys(result.a), ['c', 'd'])
      assert.deepEqual(Object.keys(result.z), ['a', 'b'])
    })

    it('should sort arrays', () => {
      const input = [3, 1, 2]
      assert.deepEqual(sort(input), [1, 2, 3])
    })

    it('should sort arrays of strings', () => {
      const input = ['c', 'a', 'b']
      assert.deepEqual(sort(input), ['a', 'b', 'c'])
    })

    it('should handle deeply nested objects with arrays', () => {
      const input = { b: [3, 1], a: { z: 1, y: 2 } }
      const result = sort(input)
      assert.deepEqual(Object.keys(result), ['a', 'b'])
      assert.deepEqual(result.b, [1, 3])
      assert.deepEqual(Object.keys(result.a), ['y', 'z'])
    })

    it('should handle empty objects', () => {
      assert.deepEqual(sort({}), {})
    })

    it('should handle empty arrays', () => {
      assert.deepEqual(sort([]), [])
    })
  })
})
