import { AxiosResponse } from 'axios'
import { Unsubscribe } from 'firebase/firestore'
import { ReplaySubject, Subscription } from 'rxjs'

// Config
export interface RetterClientConfig {
    projectId: string
    /** To support multi-config for same projectId, give different instance key. Otherwise, leave undefined */
    instanceKey?: string
    rootProjectId?: string
    url?: string
    region?: RetterRegion
    platform?: string
    culture?: string
    retryConfig?: RetterRetryConfig
    useCookies?: boolean
    /** Use it only in non-browser environments */
    memoryCache?: RetterMemoryCacheConfig
    [key: string]: any
}

/**
 * Use it only in non-browser environments
 * @interface
 */
export interface RetterMemoryCacheConfig {
    enabled: boolean
    /**
     * Maximum number of cache entries
     * @default 100
     */
    maxEntryCount?: number
    /** @default false */
    enableLogs?: boolean
}

export interface RetterRetryConfig {
    delay?: number
    count?: number
    rate?: number
}

export enum RetterRegion {
    euWest1,
    euWest1Beta,
}

export interface RetterRegionConfig {
    id: RetterRegion
    url: string
}

// Actions

export enum RetterActions {
    EMPTY = 'EMPTY',
    SIGN_IN = 'SIGN_IN',
    COS_CALL = 'COS_CALL',
    COS_LIST = 'COS_LIST',
    COS_STATE = 'COS_STATE',
    COS_INSTANCE = 'COS_INSTANCE',
    COS_STATIC_CALL = 'COS_STATIC_CALL',
}

export interface RetterActionWrapper {
    action?: RetterAction
    tokenData?: RetterTokenData

    url?: string
    response?: any
    responseError?: any
}

export interface RetterAction {
    action?: RetterActions
    data?: any

    reject?: (e: any) => any
    resolve?: (r: any) => any
}

// Auth

export enum RetterAuthStatus {
    SIGNED_IN = 'SIGNED_IN',
    SIGNED_OUT = 'SIGNED_OUT',
    AUTH_FAILED = 'AUTH_FAILED',
}

export interface RetterAuthChangedEvent {
    authStatus: RetterAuthStatus
    identity?: string
    uid?: string
    message?: string
}

export interface RetterTokenData {
    accessToken: string
    refreshToken: string
    accessTokenExpiresAt: number
    refreshTokenExpiresAt: number
    firebase: {
        apiKey: string
        projectId: string
        customToken: string
    }
    diff: number
    accessTokenDecoded?: RetterTokenPayload
    refreshTokenDecoded?: RetterTokenPayload
}

export interface RetterTokenPayload {
    serviceId?: string
    projectId?: string
    clientId?: string
    userId?: string
    anonymous?: boolean
    identity?: string
    iat?: number
    exp?: number
    claims?: {
        [key: string]: any
    }
}

// Cloud Objects

export interface RetterCloudObjectConfig {
    classId: string
    key?: { name: string; value: string }
    instanceId?: string
    method?: string
    headers?: { [key: string]: string }
    pathParams?: string
    queryStringParams?: { [key: string]: string }
    httpMethod?: 'get' | 'delete' | 'post' | 'put'
    base64Encode?: boolean
    body?: any
    platform?: string
    culture?: string
    useLocal?: boolean
    token?: string
}

export interface RetterCloudObject {
    instanceId: string
    isNewInstance: boolean
    init: {
        inputModel?: string
        queryStringModel?: string
    }
    get: {
        inputModel?: string
        queryStringModel?: string
    }
    methods: RetterCloudObjectMethod[]
    response?: any
    headers?: AxiosResponse['headers']
    call<T>(params: RetterCloudObjectCall): Promise<RetterCallResponse<T>>
    listInstances(params?: RetterCloudObjectRequest): Promise<string[]>
    getState(params?: RetterCloudObjectRequest): Promise<RetterCallResponse<RetterCloudObjectState>>
    state?: RetterCloudObjectStates
}

export interface RetterCloudObjectItem extends RetterCloudObject {
    config: RetterCloudObjectConfig
    unsubscribers: Unsubscribe[]
}

export type RetterCallResponse<T> = Omit<AxiosResponse<T>, 'config' | 'request'>

export interface RetterCloudObjectMethod {
    tag?: string
    name: string
    sync?: boolean
    readonly?: boolean
    inputModel?: string
    outputModel?: string
    queryStringModel?: string
}

export interface RetterCloudObjectState {
    role: { [key: string]: any }
    user: { [key: string]: any }
    public: { [key: string]: any }
    private: { [key: string]: any }
}

export type RetterCloudObjectRequest = Omit<RetterCloudObjectConfig, 'classId' | 'useLocal'>

export interface RetterCloudObjectCall extends RetterCloudObjectRequest {
    method: string
    retryConfig?: RetterRetryConfig
}

export interface RetterCloudObjectStaticCall extends Omit<RetterCloudObjectConfig, 'useLocal' | 'instanceId' | 'key'> {
    method: string
}

interface RetterCloudObjectStates {
    role: RetterCloudObjectStateObservable
    user: RetterCloudObjectStateObservable
    public: RetterCloudObjectStateObservable
}

interface RetterCloudObjectStateObservable {
    queue?: ReplaySubject<any>
    subscribe: (state?: any | undefined) => Subscription
}

export enum Runtime {
    web = 'web',
    node = 'node',
}
