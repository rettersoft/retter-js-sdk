import { describe, it, mock, afterEach } from 'node:test'
import assert from 'node:assert'
import axios from 'axios'
import Retter from '../src/index'
import { RetterStateError } from '../src/types'

/**
 * Realtime state subscription tests.
 * Firebase is never initialized here: `createStateListener` (the single seam around Firestore `onSnapshot`)
 * is stubbed so tests can drive `onNext` / `onError` by hand.
 */

type Captured = { collection: string; documentId: string; onNext: (d: any) => void; onError: (e: any) => void; unsubscribed: boolean }

function mockInstanceHttp() {
  mock.method(axios, 'create', () => async (_config: any) => ({
    status: 200,
    statusText: 'OK',
    headers: {},
    data: { instanceId: 'inst1', methods: [], response: null },
  }))
}

async function setup(projectId: string) {
  mockInstanceHttp()
  const rio = Retter.getInstance({ projectId, url: 'test.api' })
  await new Promise(r => setTimeout(r, 20))

  const captured: Captured[] = []
  ;(rio as any).createStateListener = (collection: string, documentId: string, onNext: any, onError: any) => {
    const entry: Captured = { collection, documentId, onNext, onError, unsubscribed: false }
    captured.push(entry)
    return () => {
      entry.unsubscribed = true
    }
  }
  // role/user scopes read identity/userId from the current user
  ;(rio as any).auth.getCurrentUser = async () => ({ userId: 'user1', identity: 'id1' })

  const obj = await rio.getCloudObject({ classId: 'MyClass', instanceId: 'inst1', useLocal: true })
  return { rio, obj, captured }
}

function firestoreError(code = 'permission-denied') {
  const e: any = new Error(`Missing or insufficient permissions (${code})`)
  e.code = code
  return e
}

async function collectUncaught(fn: () => Promise<void> | void): Promise<any[]> {
  const uncaught: any[] = []
  const handler = (e: any) => uncaught.push(e)
  process.on('uncaughtException', handler)
  try {
    await fn()
    // RxJS reports unhandled subject errors asynchronously via setTimeout
    await new Promise(r => setTimeout(r, 20))
  } finally {
    process.off('uncaughtException', handler)
  }
  return uncaught
}

describe('State subscription - legacy function-only form (must not change)', () => {
  afterEach(() => mock.restoreAll())

  it('delivers snapshots with __ prefixed keys stripped', async () => {
    const { obj, captured } = await setup('state-legacy-data')
    const received: any[] = []
    obj.state!.public.subscribe((s: any) => received.push(s))

    assert.strictEqual(captured.length, 1)
    assert.strictEqual(captured[0].collection, '/projects/state-legacy-data/classes/MyClass/instances')
    assert.strictEqual(captured[0].documentId, 'inst1')

    captured[0].onNext({ a: 1, __internal: true })
    assert.deepStrictEqual(received, [{ a: 1 }])
  })

  it('stays silent on Firestore error: no callback, no uncaught exception, data stream still usable', async () => {
    const { rio, obj, captured } = await setup('state-legacy-error')
    const received: any[] = []
    obj.state!.public.subscribe((s: any) => received.push(s))
    captured[0].onNext({ a: 1 })

    const uncaught = await collectUncaught(() => captured[0].onError(firestoreError()))

    assert.deepStrictEqual(uncaught, [])
    assert.deepStrictEqual(received, [{ a: 1 }])
    // listener is dropped so a later subscribe() can re-attach
    assert.strictEqual((rio as any).listeners['state-legacy-error_MyClass_inst1_public'], undefined)
  })
})

describe('State subscription - error callback', () => {
  afterEach(() => mock.restoreAll())

  it('subscribe(next, error) receives a RetterStateError', async () => {
    const { obj, captured } = await setup('state-err-fn')
    const errors: RetterStateError[] = []
    obj.state!.public.subscribe(
      () => {},
      (e: RetterStateError) => errors.push(e)
    )

    const original = firestoreError('permission-denied')
    captured[0].onError(original)

    assert.strictEqual(errors.length, 1)
    assert.strictEqual(errors[0].scope, 'public')
    assert.strictEqual(errors[0].classId, 'MyClass')
    assert.strictEqual(errors[0].instanceId, 'inst1')
    assert.strictEqual(errors[0].code, 'permission-denied')
    assert.ok(errors[0].message.includes('permission-denied'))
    assert.strictEqual(errors[0].original, original)
  })

  it('subscribe({ next, error }) observer form receives the error and data', async () => {
    const { obj, captured } = await setup('state-err-observer')
    const received: any[] = []
    const errors: RetterStateError[] = []
    obj.state!.user.subscribe({
      next: (s: any) => received.push(s),
      error: (e: RetterStateError) => errors.push(e),
    })

    assert.strictEqual(captured[0].collection, '/projects/state-err-observer/classes/MyClass/instances/inst1/userState')
    assert.strictEqual(captured[0].documentId, 'user1')

    captured[0].onNext({ x: 1 })
    captured[0].onError(firestoreError('unauthenticated'))

    assert.deepStrictEqual(received, [{ x: 1 }])
    assert.strictEqual(errors.length, 1)
    assert.strictEqual(errors[0].scope, 'user')
    assert.strictEqual(errors[0].code, 'unauthenticated')
  })

  it('role scope uses identity as document id and reports scope=role', async () => {
    const { obj, captured } = await setup('state-err-role')
    const errors: RetterStateError[] = []
    obj.state!.role.subscribe(() => {}, (e: RetterStateError) => errors.push(e))

    assert.strictEqual(captured[0].documentId, 'id1')
    captured[0].onError(firestoreError('unavailable'))
    assert.strictEqual(errors[0].scope, 'role')
  })

  it('after an error, subscribe() re-attaches a fresh listener', async () => {
    const { obj, captured } = await setup('state-err-reattach')
    obj.state!.public.subscribe(() => {}, () => {})
    assert.strictEqual(captured.length, 1)

    captured[0].onError(firestoreError())

    const errors: RetterStateError[] = []
    const received: any[] = []
    obj.state!.public.subscribe((s: any) => received.push(s), (e: RetterStateError) => errors.push(e))
    assert.strictEqual(captured.length, 2, 'a second listener should be created after the first errored')

    captured[1].onNext({ fresh: true })
    assert.deepStrictEqual(received, [{ fresh: true }])
    assert.strictEqual(errors.length, 0)
  })

  it('without an error, a second subscribe() reuses the existing listener (dedupe unchanged)', async () => {
    const { obj, captured } = await setup('state-dedupe')
    obj.state!.public.subscribe(() => {})
    obj.state!.public.subscribe(() => {}, () => {})
    assert.strictEqual(captured.length, 1)
  })

  it('unsubscribe() detaches both data and error handlers', async () => {
    const { obj, captured } = await setup('state-err-unsub')
    const received: any[] = []
    const errors: RetterStateError[] = []
    const sub = obj.state!.public.subscribe((s: any) => received.push(s), (e: RetterStateError) => errors.push(e))
    sub.unsubscribe()

    captured[0].onNext({ a: 1 })
    captured[0].onError(firestoreError())

    assert.deepStrictEqual(received, [])
    assert.deepStrictEqual(errors, [])
  })

  it('errors are only delivered to the scope they belong to', async () => {
    const { obj, captured } = await setup('state-err-scope-isolation')
    const publicErrors: RetterStateError[] = []
    const userErrors: RetterStateError[] = []
    obj.state!.public.subscribe(() => {}, (e: RetterStateError) => publicErrors.push(e))
    obj.state!.user.subscribe(() => {}, (e: RetterStateError) => userErrors.push(e))

    const userListener = captured.find(c => c.collection.endsWith('/userState'))!
    userListener.onError(firestoreError())

    assert.strictEqual(publicErrors.length, 0)
    assert.strictEqual(userErrors.length, 1)
  })

  it('rio.stateErrors aggregates errors from every cloud object and scope', async () => {
    const { rio, obj, captured } = await setup('state-err-global')
    const all: RetterStateError[] = []
    rio.stateErrors.subscribe(e => all.push(e))

    obj.state!.public.subscribe(() => {})
    obj.state!.user.subscribe(() => {})
    captured[0].onError(firestoreError('permission-denied'))
    captured[1].onError(firestoreError('unavailable'))

    assert.deepStrictEqual(
      all.map(e => [e.scope, e.code]),
      [
        ['public', 'permission-denied'],
        ['user', 'unavailable'],
      ]
    )
  })

  it('signOut() tears down listeners and completes error channels without throwing', async () => {
    const { rio, obj, captured } = await setup('state-err-signout')
    const errors: RetterStateError[] = []
    let completed = false
    obj.state!.public.subscribe({
      next: () => {},
      error: (e: RetterStateError) => errors.push(e),
      complete: () => {
        completed = true
      },
    })

    await rio.signOut()

    assert.strictEqual(captured[0].unsubscribed, true)
    assert.strictEqual(completed, true, 'data queue completes on signOut (existing behaviour)')

    const uncaught = await collectUncaught(() => captured[0].onError(firestoreError()))
    assert.deepStrictEqual(uncaught, [])
    assert.deepStrictEqual(errors, [])
  })
})
