## Installation

Using npm:

```bash
npm install @retter/sdk
```

Using yarn:

```bash
yarn add @retter/sdk
```

Using unkpg:

```html
<script src="https://unpkg.com/@retter/sdk/bundle/index.js"></script>
```

> You can use global `Retter` keyword.

## Usage

### Initialization

Clients should initialize with project id. Instances with same project id always be cached.

```ts
import Retter from '@retter/sdk'

const rio = Retter.getInstance(config: RetterClientConfig)

interface RetterClientConfig {
    projectId: string
    instanceKey?: string // to support multi-config for same projectId, give different instance key. Otherwise, leave undefined
    rootProjectId?: string
    region?: RetterRegion
    platform?: string
    culture?: string
    memoryCache?: { // use it only in non-browser environments
      enabled: boolean
      maxEntryCount?: number // default: 100
      enableLogs?: boolean // default: false
    }
}
```

> **projectId**: Unique id of a project created in [retter.io Console](https://retter.io)
>
> **region**: Could be `euWest1` or `euWest1Beta`
>
> **platform**: web, node
>
> **culture**: tr, en-US, vs....

### Authentication

Retter uses custom token to authenticate. This custom tokens can be given by an action or a cloud object.

```ts
await rio.authenticateWithCustomToken('{CUSTOM_TOKEN}')
```

Authentication statuses can be listened. SDK will fire an event that clients can be subscribe on status change.

```ts
rio.authStatus.subscribe((event: RetterAuthChangedEvent) => {
    //
})
```

Event gives information about current auth status. Clients can check the `authStatus` to determine if they need to show login/register pages or not.

```ts
interface RetterAuthChangedEvent {
    authStatus: RetterAuthStatus
    identity?: string
    uid?: string
    message?: string
}

enum RetterAuthStatus {
    SIGNED_IN = 'SIGNED_IN',
    SIGNED_OUT = 'SIGNED_OUT',
    AUTH_FAILED = 'AUTH_FAILED',
}
```

## Cloud Objects

SDK will allow to use Retter Cloud Objects. Clients can subscribe realtime state changes, trigger cloud methods, ...

Firstly, a cloud object must be initilize with `classId`. Additional config options can be seen in interface below.

```ts
const cloudObject = await rio.getCloudObject(config: RetterCloudObjectConfig)

interface RetterCloudObjectConfig {
    classId: string
    key?: {
        name: string
        value: string
    }
    instanceId?: string
    method?: string
    headers?: {
        [key: string]: string
    }
    pathParams?: string
    queryStringParams?: {
        [key: string]: string
    }
    body?: {
        [key: string]: any
    }
    httpMethod?: 'get' | 'delete' | 'post' | 'put'
    base64Encode?: boolean // default: true, only get requests
}
```

### State Subscription

Clients can be subscribe to realtime state (public, user and role states) changes. On first subscription, it gives current state.

```ts
cloudObject.state.public.subscribe((state: { [key: string]: any }) => {
    //
})

cloudObject.state.user.subscribe((state: { [key: string]: any }) => {
    //
})

cloudObject.state.role.subscribe((state: { [key: string]: any }) => {
    //
})
```

### Method Calls

Any cloud method can be called via sdk. `method` parameter must be specified. Other parameters can be seen in interface below.

```ts
const response = await cloudObject.call(params: RetterCloudObjectCall)

interface RetterCloudObjectCall {
    method: string
    headers?: {
        [key: string]: string
    }
    queryStringParams?: {
        [key: string]: string
    }
    body?: {
        [key: string]: any
    }
    httpMethod?: 'get' | 'delete' | 'post' | 'put' // default: post
    base64Encode?: boolean // default: true, only get requests
    retryConfig: {
        delay?: number // 50ms
        count?: number // 3
        rate?: number // 1.5
    }
}
```

Call method will return a response with `RetterCallResponse` type includes `data`, `status` and `headers`.

### Getting State

Clients also access state via method call.

```ts
const response = await cloudObject.getState(params: RetterCloudObjectRequest)

interface RetterCloudObjectRequest {
    headers?: {
        [key: string]: string
    }
    queryStringParams?: {
        [key: string]: string
    }
    body?: {
        [key: string]: any
    }
    httpMethod?: 'get' | 'delete' | 'post' | 'put'
}
```

Get stae method will return a response with `RetterCallResponse` type includes `data<RetterCloudObjectState>`, `status` and `headers`.

### Available Methods

Cloud objects available methods can be accessed on `methods` array/

```ts
const methods = cloudObject.methods: RetterCloudObjectMethod[]

interface RetterCloudObjectMethod {
    tag?: string
    name: string
    sync?: boolean
    readonly?: boolean
    inputModel?: string
    outputModel?: string
    queryStringModel?: string
}
```

### Instance List

```ts
const instanceIds = await cloudObject.listInstances()
```

## Static Calls

> make sure using sdk version v0.5.3 or higher

Static method calls can be made via sdk. Getting a cloud object is not necessary. Simple call `makeStaticCall` method on rio objecty. `classId` and `method` parameters must be specified. Other parameters can be seen in interface below.

```ts
interface RetterCloudObjectStaticCall {
    classId: string
    method: string
    headers?: { [key: string]: string }
    pathParams?: string
    queryStringParams?: { [key: string]: string }
    httpMethod?: 'get' | 'delete' | 'post' | 'put'
    body?: any
    platform?: string
    culture?: string
}
```

Example:

```ts
import Retter from '@retter/sdk'

const rio = Retter.getInstance(config: RetterClientConfig)

await rio.makeStaticCall({
    classId: 'StaticTest',
    method: 'methodName',
})
```
