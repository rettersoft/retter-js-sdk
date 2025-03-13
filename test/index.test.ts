import { describe, it } from 'node:test'
import Retter from '../src'
import assert from 'node:assert'

describe('index tests', () => {
  it('should support multi-config', async () => {
    const i1 = Retter.getInstance({ projectId: 'p1' })
    const i2 = Retter.getInstance({ projectId: 'p1', instanceKey: 'key1' })
    const i3 = Retter.getInstance({ projectId: 'p1', instanceKey: 'key2' })
    const i4 = Retter.getInstance({ projectId: 'p1', instanceKey: 'key1' })
    const i5 = Retter.getInstance({ projectId: 'p1' })
    const i6 = Retter.getInstance({ projectId: 'p2' })

    assert.equal(i1, i5)
    assert.equal(i2, i4)
    assert.notEqual(i1, i2)
    assert.notEqual(i1, i6)
    assert.notEqual(i2, i3)
  })
})
