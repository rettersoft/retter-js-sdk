# Realtime State Errors (`@retter/sdk` ≥ 0.17.0)

How to be notified when a realtime state subscription (`cloudObject.state.{public,user,role}.subscribe`) fails, what was added in 0.17.0, and why.

---

## TL;DR

```ts
cloudObject.state.public.subscribe(
    state => {
        // latest state, as before
    },
    error => {
        // NEW: fires when the Firestore listener fails
        console.warn(`realtime ${error.scope} state lost: ${error.code}`)
    }
)
```

Nothing changes for existing code. If you keep calling `subscribe(fn)` with a single function, behaviour is identical to 0.16.0.

---

## 1. Why this was added

Realtime state is delivered over a Firestore `onSnapshot` listener that the SDK opens on your behalf. Firestore can terminate that listener at any time:

| Firestore code | Typical cause |
|---|---|
| `permission-denied` | Security rules rejected the read (wrong identity, instance not readable by this user) |
| `unauthenticated` | The Firebase custom-token session expired or was revoked |
| `unavailable` | Network / backend outage, client offline for too long |
| `resource-exhausted` | Quota exceeded |
| `cancelled`, `internal`, `unknown` | Transport-level failures |

Before 0.17.0 the SDK registered **only** the `onNext` callback. When Firestore reported an error:

- the listener was closed by Firestore and **no further state events arrived**,
- the SDK did not notify the subscriber in any way,
- the SDK still believed the listener was alive, so calling `subscribe()` again reused the dead one.

From the application's point of view the UI simply stopped updating with no signal. The Android SDK already exposes `errorFired` next to `eventFired`; the JS SDK now offers the same.

---

## 2. What was added

### `RetterStateError`

```ts
import { RetterStateError, RetterStateScope } from '@retter/sdk'

type RetterStateScope = 'public' | 'user' | 'role'

interface RetterStateError {
    scope: RetterStateScope   // which state channel failed
    classId: string
    instanceId: string
    code: string              // Firestore error code, e.g. 'permission-denied'
    message: string
    original: unknown         // the raw FirestoreError
}
```

### Error handler on `subscribe`

`state.<scope>.subscribe` accepts an optional second argument, or an RxJS-style observer object:

```ts
subscribe(next)                    // legacy — unchanged, errors are NOT delivered
subscribe(next, error)             // NEW
subscribe({ next, error, complete }) // NEW (RxJS observer form)
```

### `rio.stateErrors`

An instance-wide `Observable<RetterStateError>` that emits every listener error across all cloud objects and scopes. Useful for a single global "realtime connection lost" indicator or for telemetry.

```ts
rio.stateErrors.subscribe(error => telemetry.track('rio.state.error', error))
```

### Self-healing subscribe

After an error the SDK forgets the dead listener. The next `subscribe()` call on that scope opens a fresh Firestore listener instead of attaching to the closed one.

---

## 3. How to use it

### 3.1 Minimal: log and show a banner

```ts
const order = await rio.getCloudObject({ classId: 'Order', instanceId: orderId, useLocal: true })

const sub = order.state!.public.subscribe(
    state => renderOrder(state),
    error => showBanner(`Live updates paused (${error.code})`)
)

// later
sub.unsubscribe() // detaches BOTH the state and the error handler
```

### 3.2 Re-attach after an error

Firestore closes the listener after an error, so if you want live updates back you must subscribe again. A simple retry with backoff:

```ts
function watchPublic(obj: RetterCloudObject, onState: (s: any) => void, attempt = 0): Subscription {
    return obj.state!.public.subscribe(onState, error => {
        if (error.code === 'permission-denied') {
            // Not transient. Surface it, do not retry.
            showError('You no longer have access to this object.')
            return
        }
        const delay = Math.min(30_000, 1_000 * 2 ** attempt)
        setTimeout(() => watchPublic(obj, onState, attempt + 1), delay)
    })
}
```

> `unauthenticated` usually means the Firebase custom-token session is gone. The SDK refreshes RIO tokens and re-initialises Firebase on the next authenticated call, so a common pattern is to trigger a cheap `call` or `getState` and then re-subscribe.

### 3.3 React hook

```tsx
function usePublicState(obj?: RetterCloudObject) {
    const [state, setState] = useState<any>()
    const [error, setError] = useState<RetterStateError>()

    useEffect(() => {
        if (!obj) return
        setError(undefined)
        const sub = obj.state!.public.subscribe(setState, setError)
        return () => sub.unsubscribe()
    }, [obj])

    return { state, error }
}
```

### 3.4 RxJS observer form

```ts
obj.state!.user.subscribe({
    next: state => setUserState(state),
    error: err => setUserError(err),
    complete: () => console.debug('user state stream closed (signOut)'),
})
```

`complete` fires when `rio.signOut()` tears the streams down. This was already the case in earlier versions.

### 3.5 One global listener

```ts
rio.stateErrors.subscribe(error => {
    if (error.code === 'unauthenticated') {
        // e.g. kick off re-auth / token refresh
    }
    console.warn('[rio] realtime error', error.scope, error.classId, error.instanceId, error.code)
})
```

`rio.stateErrors` never errors or completes on its own; subscribe once at app start.

---

## 4. Migration

| You currently do | Do you need to change anything? |
|---|---|
| `state.public.subscribe(fn)` | No. Behaviour is byte-for-byte the same. Optionally add a second argument to start receiving errors. |
| `state.public.subscribe({ next })` | No. Optionally add `error`. |
| Type-check against `RetterCloudObject['state']` | No. The `subscribe` signature only gained an optional parameter. |
| Depend on the SDK throwing on Firestore errors | Nothing changed. The SDK never threw for listener errors; it now reports them via the callback instead of dropping them. |

Bump `@retter/sdk` to `0.17.0` in `package.json`. No peer-dependency or Firebase version change.

---

## 5. Behaviour details

- **The state stream never errors.** The `ReplaySubject` behind `state.<scope>` only emits `next` and `complete`. Errors travel on a separate channel. This is deliberate: in RxJS 7 an errored subject with no error handler throws asynchronously as an uncaught exception, which would have broken every existing subscriber.
- **One listener per scope per instance** (keyed `{projectId}_{classId}_{instanceId}_{scope}`). Multiple `subscribe()` calls share it. After an error the key is dropped; the next `subscribe()` recreates the listener. Existing subscribers of the errored listener are **not** automatically re-attached; they receive the error and should re-subscribe.
- **Last value replay.** A fresh `subscribe()` after an error still replays the last known state from the `ReplaySubject(1)` before new snapshots arrive.
- **Unsubscribe.** The `Subscription` returned by `subscribe(next, error)` covers both handlers. Unsubscribing does not close the shared Firestore listener; that happens on `rio.signOut()` or re-authentication.
- **Synchronous failures are unchanged.** If Firebase was never initialised (e.g. token data without a `firebase` block), `subscribe()` still throws synchronously as before. The error callback is only for asynchronous Firestore listener errors.
- **Not covered:** failures of `signInWithCustomToken` during SDK auth. Those still surface via `rio.authStatus` (`SIGNED_OUT` / `AUTH_FAILED`).

---

## 6. Reference

```ts
interface RetterCloudObjectStateObservable {
    queue?: ReplaySubject<any>
    subscribe: (
        observerOrNext?: RetterStateNext | Partial<Observer<any>>,
        error?: RetterStateErrorHandler
    ) => Subscription
}

type RetterStateNext = (state: { [key: string]: any }) => void
type RetterStateErrorHandler = (error: RetterStateError) => void

class Retter {
    get stateErrors(): Observable<RetterStateError>
}
```

Exports added in 0.17.0: `RetterStateScope`, `RetterStateError`, `RetterStateNext`, `RetterStateErrorHandler`.

Related: `docs/backend-api.md` §9 (Firestore documents and listener lifecycle).
