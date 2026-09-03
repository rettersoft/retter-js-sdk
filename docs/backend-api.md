# Backend APIs consumed by @retter/sdk

This document describes every remote API the SDK talks to, from the SDK's point of view. It is derived from the source (`src/Request.ts`, `src/Auth.ts`, `src/index.ts`, `src/cache.ts`) as of **SDK v0.16.0**.

The SDK has exactly **two remote surfaces**:

1. **The RIO HTTP API** — the customer environment's API Gateway (HTTP API) fronting core-extension Lambdas, called via axios.
2. **Google Firebase** — Firebase Auth (`signInWithCustomToken`) and Cloud Firestore (`onSnapshot` document listeners) for realtime state, using the Firebase config embedded in the token response.

Everything else in the SDK (JWT decode, cookie/localStorage token persistence, LRU memory cache, RxJS queues) is local.

---

## Endpoint summary

| # | Endpoint | HTTP method | Auth | Triggered by |
|---|---|---|---|---|
| 1 | `/{projectId}/TOKEN/auth` | POST | none | `authenticateWithCustomToken()` |
| 2 | `/{projectId}/TOKEN/refresh` | POST | none (tokens in body) | automatic, when access token expired |
| 3 | `/{projectId}/TOKEN/signOut` | POST | Bearer | `signOut()` |
| 4 | `/{projectId}/INSTANCE/{classId}[/{instanceId}]` | configurable, default POST | Bearer (optional) | `getCloudObject()` |
| 5 | `/{projectId}/CALL/{classId}/{method}/{instanceId}[/{pathParams}]` | configurable, default POST | Bearer (optional) | `cloudObject.call()` |
| 6 | `/{projectId}/CALL/{classId}/{method}[/{pathParams}]` | configurable, default POST | Bearer (optional) | `makeStaticCall()` |
| 7 | `/{projectId}/STATE/{classId}/{instanceId}` | configurable, default POST | Bearer (optional) | `cloudObject.getState()` |
| 8 | `/{projectId}/LIST/{classId}` | configurable, default POST | Bearer (optional) | `cloudObject.listInstances()` |
| 9 | Firestore document listeners (see below) | — | Firebase custom-token session | `cloudObject.state.{public,user,role}.subscribe()` |

Server side: `TOKEN/*` is routed to a dedicated token Lambda (`/{projectId}/TOKEN/{proxy+}` route in `rio-core-extension/cdk/COSServiceStack.ts`); `INSTANCE`, `CALL`, `STATE`, `LIST` are handled by core-extension's method/instance/getState handlers.

---

## Base URL construction

`Request.buildUrl()`:

```
https://{host}/{projectId}/{path}
```

- If `RetterClientConfig.url` is set → `host = config.url` (custom domain, e.g. `api.<subdomain>.retter.io`). The `/{projectId}/` path prefix is **still applied**.
- Otherwise host comes from the region table:

| `RetterRegion` | Host |
|---|---|
| `euWest1` (default) | `{projectId}.api.retter.io` |
| `euWest1Beta` | `{projectId}.test-api.retter.io` |

## Conventions applied to every HTTP request

**Headers**

| Header | Value | Notes |
|---|---|---|
| `Content-Type` | `application/json` | always |
| `rio-sdk-version` | e.g. `0.16.0` | omitted if `sdkVersionHeader: false` |
| `Authorization` | `Bearer <accessToken>` | see per-endpoint rules below |

For cloud-object requests, caller-supplied `headers` are merged in first; when a token exists (per-request `token` override, else the stored session's access token) the SDK **overwrites** any caller-supplied `Authorization` header. With no session and no `token` override, the request goes out without `Authorization` (anonymous identity).

**Query string parameters**

| Param | Value | Applied to |
|---|---|---|
| `__culture` | per-request `culture` → client config `culture` → `en-us` | all cloud-object requests; TOKEN requests only when set in client config |
| `__platform` | per-request `platform` → client config `platform` | only when set |
| `data` | base64(JSON.stringify(body with keys deep-sorted)) | GET requests with a body, unless `base64Encode: false` |
| `__isbase64` | `true` | set together with `data` |

The deep key-sort before encoding makes the query string deterministic, so identical GET bodies produce identical URLs — this is what makes GET responses cacheable (CDN and the SDK's own memory cache).

**Other client behavior**

- axios timeout: **30 s**, `responseType: 'json'`.
- Optional in-memory LRU cache (`memoryCache.enabled`, non-browser use): GET responses are cached according to `Cache-Control: max-age`, `Age` and `Date` response headers, with in-flight request de-duplication.

---

## 1–3. Token endpoints

### `POST /{projectId}/TOKEN/auth`

Exchange a custom token (produced by usercode, e.g. via RDK `generateCustomToken`) for a session.

Request body:

```json
{ "customToken": "<jwt>" }
```

Response body — `RetterTokenData`:

```jsonc
{
  "accessToken": "<jwt>",
  "refreshToken": "<jwt>",
  "accessTokenExpiresAt": 0,
  "refreshTokenExpiresAt": 0,
  "firebase": {                      // used to open the realtime state channel
    "apiKey": "<firebase web api key>",
    "projectId": "<firebase project id>",
    "customToken": "<firebase custom auth token>"
  }
}
```

The access/refresh tokens are JWTs whose payload the SDK decodes locally (`RetterTokenPayload`): `projectId`, `userId`, `identity`, `anonymous`, `clientId`, `serviceId`, `claims`, `iat`, `exp`. `userId` and `identity` also select the Firestore documents for user/role state (see §9).

The SDK computes a client↔server clock-skew `diff = iat - now` at sign-in and uses it for all later expiry checks.

### `POST /{projectId}/TOKEN/refresh`

Called automatically before any queued action when the access token is expired (with a 30-second safety margin, skew-corrected) but the refresh token is still valid. No `Authorization` header.

Request body:

```json
{ "refreshToken": "<jwt>", "accessToken": "<jwt>" }
```

Response: same `RetterTokenData` shape as `TOKEN/auth`. If the refresh call throws, the SDK clears the session locally (sign-out).

### `POST /{projectId}/TOKEN/signOut`

Best-effort server-side session invalidation, sent with `Authorization: Bearer <accessToken>` and no body. **Errors are swallowed** — local token clearing and Firebase sign-out happen regardless.

---

## 4. `INSTANCE — /{projectId}/INSTANCE/{classId}[/{instanceId}]`

Called by `getCloudObject()` to create or attach to a cloud-object instance (skipped entirely when `useLocal: true` and an `instanceId` is provided).

Path variants:

- `INSTANCE/{classId}` — no instance id: asks the class to create/resolve a new instance.
- `INSTANCE/{classId}/{instanceId}` — attach to a known instance.
- `INSTANCE/{classId}/{keyName}!{keyValue}` — look-up-key resolution; built from `config.key = { name, value }` (takes precedence over `instanceId`).

Request: default `POST` (overridable via `httpMethod`), optional `body`, `headers`, `queryStringParams` pass through.

Response body (fields the SDK consumes):

```jsonc
{
  "instanceId": "01H...",
  "newInstance": true,          // → exposed as isNewInstance
  "init": { "inputModel": "...", "queryStringModel": "..." },
  "get":  { "inputModel": "...", "queryStringModel": "..." },
  "methods": [                  // → RetterCloudObjectMethod[]
    { "name": "...", "tag": "...", "sync": true, "readonly": true,
      "inputModel": "...", "outputModel": "...", "queryStringModel": "..." }
  ],
  "response": { }               // optional payload from the class's init/get delegate
}
```

Response headers are also surfaced to the caller (`cloudObject.headers`).

## 5–6. `CALL — /{projectId}/CALL/{classId}/{method}/...`

- Instance method (`cloudObject.call({ method, ... })`): `CALL/{classId}/{method}/{instanceId}[/{pathParams}]`
- Static method (`makeStaticCall({ classId, method, ... })`): `CALL/{classId}/{method}[/{pathParams}]`

Request: default `POST`; `body`, `headers`, `queryStringParams`, `httpMethod`, `culture`, `platform`, per-call `token` all configurable. Response is passed through as `RetterCallResponse<T>` = `{ data, status, statusText, headers }`.

**Retry on 570**: instance-method calls (only via `cloudObject.call`) retry on HTTP status **570** with exponential backoff — defaults `count: 3`, `delay: 50 ms`, `rate: ×1.5`, overridable per client config and per call. 570 is emitted by core-extension when a **sync write-method lock** on the instance cannot be acquired (Redis lock in `lock.helper.ts`), i.e. "instance busy".

## 7. `STATE — /{projectId}/STATE/{classId}/{instanceId}`

One-shot state read (`cloudObject.getState()`). Response `data` is `RetterCloudObjectState`:

```jsonc
{ "public": {}, "user": {}, "role": {}, "private": {} }
```

(What is actually visible is decided server-side by the class's ACL/authorizer.)

## 8. `LIST — /{projectId}/LIST/{classId}`

Instance-id listing (`cloudObject.listInstances()`). The SDK reads `data.instanceIds: string[]` from the response.

---

## Error-handling contract (HTTP)

| Condition | SDK behavior |
|---|---|
| HTTP **570** on `cloudObject.call` | retry with backoff (see above), then rethrow |
| HTTP **403** with body `{ "code": "ACCESS_DENIED" }` on any queued action | local `signOut()` (tokens cleared, Firebase disconnected), error rethrown to caller |
| `TOKEN/refresh` failure | local sign-out; action proceeds unauthenticated |
| `TOKEN/signOut` failure | ignored |
| Any other non-2xx | rethrown to the caller as an axios error |

---

## 9. Firebase (realtime state channel)

After a successful `TOKEN/auth` / `TOKEN/refresh`, the SDK initializes a Firebase app **named after the RIO projectId** using the `firebase` block of `RetterTokenData`:

```ts
initializeApp({ apiKey, authDomain: `${firebase.projectId}.firebaseapp.com`, projectId: firebase.projectId }, rioProjectId)
signInWithCustomToken(auth, firebase.customToken)
```

`cloudObject.state.{public,user,role}.subscribe()` then opens Firestore `onSnapshot` listeners on these documents (written server-side by core-extension's Firestore stream handler; read access is enforced by Firestore security rules against the custom-token identity):

| State | Firestore document |
|---|---|
| `public` | `/projects/{projectId}/classes/{classId}/instances/{instanceId}` |
| `user` | `/projects/{projectId}/classes/{classId}/instances/{instanceId}/userState/{userId}` |
| `role` | `/projects/{projectId}/classes/{classId}/instances/{instanceId}/roleState/{identity}` |

`{userId}` and `{identity}` come from the decoded access token. Document fields prefixed with `__` are stripped before delivery to subscribers. Listeners are de-duplicated per `{projectId}_{classId}_{instanceId}_{scope}` and torn down (plus Firebase `signOut`) on `rio.signOut()` or re-authentication.

**Listener errors** (since 0.17.0): `onSnapshot`'s `onError` is wired. When Firestore reports an error (`permission-denied`, `unauthenticated`, `unavailable`, …) the SDK builds a `RetterStateError { scope, classId, instanceId, code, message, original }`, emits it to the `error` handler passed to `state.<scope>.subscribe(next, error)` / `subscribe({ next, error })`, and to the instance-wide `rio.stateErrors` observable. The de-dupe entry for that listener is removed so a later `subscribe()` re-attaches. The state `ReplaySubject` itself never errors, so function-only subscribers see exactly the pre-0.17.0 behaviour (silence).

---

## What the SDK does *not* call

- No direct AWS calls (S3/DynamoDB/SQS etc.) — everything goes through the RIO HTTP API.
- No telemetry/analytics endpoints.
- `jwt-decode` runs locally; token signatures are never verified client-side.
