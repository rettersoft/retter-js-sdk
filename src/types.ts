import { Observable } from 'rxjs'
import { AxiosResponse } from 'axios'
import { Unsubscribe } from '@firebase/util'

// Config
export interface RetterClientConfig {
    projectId: string
    rootProjectId?: string
    region?: RetterRegion
    platform?: string
    culture?: string
    [key: string]: any
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
    SIGN_IN = 'SIGN_IN',
    SIGN_IN_ANONYM = 'SIGN_IN_ANONYM',
    COS_CALL = 'COS_CALL',
    COS_STATE = 'COS_STATE',
    COS_INSTANCE = 'COS_INSTANCE',
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
    SIGNED_IN_ANONYM = 'SIGNED_IN_ANONYM',
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
    queryStringParams?: { [key: string]: string }
    httpMethod?: 'get' | 'delete' | 'post' | 'put'
    body?: any
    platform?: string
    culture?: string
    useLocal?: boolean
    token?: string
}

export interface RetterCloudObject {
    instanceId: string
    isNewInstance: boolean
    methods: RetterCloudObjectMethod[]
    response?: any
    call<T>(params: RetterCloudObjectCall): Promise<RetterCallResponse<T>>
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
}

interface RetterCloudObjectStates {
    role: Observable<any>
    user: Observable<any>
    public: Observable<any>
}
