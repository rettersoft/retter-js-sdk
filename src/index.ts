import jwtDecode from 'jwt-decode'
import log, { LogLevelDesc } from 'loglevel'
import { Unsubscribe } from '@firebase/util'
import { getFirestore } from 'firebase/firestore'
import { FirebaseApp, initializeApp } from 'firebase/app'
import { doc, Firestore, onSnapshot } from 'firebase/firestore'
import { Subject, Observable, defer, ReplaySubject } from 'rxjs'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios'
import { Auth, getAuth, signInWithCustomToken, signOut } from 'firebase/auth'
import { tap, concatMap, materialize, filter, share, map, mergeMap, distinctUntilChanged } from 'rxjs/operators'

import base64Helpers from './base64'
import initializeAxios from './axiosSetup'
import { createResponse, ActionEvent, RESPONSE_TYPE, parseClassValidatorErrors, ValidationError } from './helpers'

export { ActionEvent, createResponse, RESPONSE_TYPE, parseClassValidatorErrors, ValidationError }

enum LogLevel {
    VERBOSE = 1,
    DEBUG,
    ERROR,
}

interface LogMessage {
    level: LogLevel
    message: string
}

export interface ServiceResponse {
    errorCode: string
    serviceId: string
    status: number
    errors: string[]
    response: any
    durationInMilliseconds: number
    executionDurationInMilliseconds: number
    headers: {
        [key: string]: string
    }
}

export interface RbsJwtPayload {
    serviceId?: string
    projectId?: string
    clientId?: string
    userId?: string
    anonymous?: boolean
    identity?: string
    iat?: number
    exp?: number
}

export interface RBSTokenData {
    accessToken: string
    refreshToken: string
    firebaseToken?: string
    accessTokenExpiresAt: number
    refreshTokenExpiresAt: number
    isServiceToken: boolean
    firebase?: FirebaseConfig
}

type SuccessCallBack = (resp: any) => any
type ErrorCallBack = (e: any) => any

export interface RBSAction {
    action?: string
    targetServiceId?: string
    relatedUserId?: string
    data?: any
    culture?: string
    headers?: { [key: string]: string }
    pop?: boolean
    token?: string

    generateGetUrl?: boolean

    onSuccess?: SuccessCallBack
    onError?: ErrorCallBack
}

interface FirebaseConfig {
    apiKey: string
    projectId: string
    customToken: string
}

interface RBSActionWrapper {
    action?: RBSAction
    tokenData?: RBSTokenData
    response?: any
    responseError?: Error
    url?: string
}

export interface RbsRegionConfiguration {
    regionId?: RbsRegion
    getUrl: string
    url: string
    apiUrl: string
}

export enum RbsRegion {
    euWest1,
    euWest1Beta,
}

const RbsRegions: RbsRegionConfiguration[] = [
    {
        regionId: RbsRegion.euWest1,
        getUrl: 'https://core.rtbs.io',
        url: 'https://core-internal.rtbs.io',
        apiUrl: 'api.rtbs.io',
    },
    {
        regionId: RbsRegion.euWest1Beta,
        getUrl: 'https://core-test.rtbs.io',
        url: 'https://core-internal-beta.rtbs.io',
        apiUrl: 'test-api.rtbs.io',
    },
]

interface RBSClientConfig {
    projectId: string
    secretKey?: string
    developerId?: string
    serviceId?: string
    region?: RbsRegion
    regionConfiguration?: RbsRegionConfiguration
    anonymTokenTTL?: number
    logLevel?: LogLevelDesc
    platform?: string
}

export enum RBSAuthStatus {
    SIGNED_IN = 'SIGNED_IN',
    SIGNED_IN_ANONYM = 'SIGNED_IN_ANONYM',
    SIGNED_OUT = 'SIGNED_OUT',
    AUTH_FAILED = 'AUTH_FAILED',
}

export interface RBSAuthChangedEvent {
    authStatus: RBSAuthStatus
    identity?: string
    uid?: string
    message?: string
}

interface RBSCloudObjectStates {
    role: Observable<any> | null
    user: Observable<any> | null
    public: Observable<any> | null
}

interface RBSCloudObjectMethod {
    tag?: string
    name: string
    sync?: boolean
    readonly?: boolean
}

export interface RBSCloudObjectState {
    role: { [key: string]: any }
    user: { [key: string]: any }
    public: { [key: string]: any }
    private: { [key: string]: any }
}

export type RBSCallResponse<T> = Omit<AxiosResponse<T>, 'config' | 'request'>

interface RBSCloudObjectItem {
    config: RBSCloudObjectData
    isNewInstance: boolean
    methods?: RBSCloudObjectMethod[]
    call(params: RBSCloudObjectCallData): Promise<RBSCallResponse<any>>
    state: RBSCloudObjectStates
    getState(params?: RBSCloudObjectRequest): Promise<RBSCallResponse<RBSCloudObjectState>>
    unsubscribers: (Unsubscribe | null)[]
}

export interface RBSCloudObject {
    instanceId: string
    isNewInstance: boolean
    methods: RBSCloudObjectMethod[]
    call(params: RBSCloudObjectCallData): Promise<RBSCallResponse<any>>
    getState(params?: RBSCloudObjectRequest): Promise<RBSCallResponse<RBSCloudObjectState>>
    state?: RBSCloudObjectStates
}
// export interface RBSLocalCloudObject {
//     instanceId: string
//     call(params: RBSCloudObjectCallData): Promise<RBSCallResponse<any>>
// }

export interface RBSCloudObjectData {
    classId: string
    key?: { name: string; value: string }
    instanceId?: string
    method?: string
    headers?: { [key: string]: string }
    querystring?: { [key: string]: string }
    httpMethod?: 'get' | 'delete' | 'post' | 'put'
    payload?: { [key: string]: any }
    useLocal?: boolean
    token?: string
}

export type RBSCloudObjectRequest = Omit<RBSCloudObjectData, 'classId' | 'useLocal'>

export interface RBSCloudObjectCallData extends RBSCloudObjectRequest {
    method: string
}

const RBS_TOKENS_KEY = 'RBS_TOKENS_KEY'

export default class RBS {
    private static instances: Array<RBS> | null = null

    private firebaseApp: FirebaseApp | null = null

    private firestore: Firestore | null = null

    private firebaseAuth: Auth | null = null

    private cloudObjects: RBSCloudObjectItem[] = []

    private commandQueue = new Subject<RBSAction>()
    private customAuthQueue = new Subject<RBSAction>()

    private clientConfig: RBSClientConfig | null = null
    private axiosInstance: AxiosInstance | null = null

    // Used in node env
    private latestTokenData?: RBSTokenData

    private initialized: boolean = false

    isNode(): boolean {
        return typeof window === 'undefined'
    }

    private authStatusSubject = new ReplaySubject<RBSAuthChangedEvent>(1)

    public get authStatus(): Observable<RBSAuthChangedEvent> {
        return this.authStatusSubject.asObservable().pipe(distinctUntilChanged((a, b) => a.authStatus === b.authStatus && a.identity === b.identity && a.uid === b.uid))
        // .pipe(debounce(() => timer(100)))
    }

    private getServiceEndpoint = (actionWrapper: RBSActionWrapper): string => {
        let endpoint = actionWrapper.tokenData!.isServiceToken ? '/service/action' : '/user/action'
        const action = actionWrapper.action!.action!
        const actionType = action.split('.')[2]
        endpoint = `${endpoint}/${this.clientConfig!.projectId}/${action}`
        return endpoint
    }

    private getRegion = (): RbsRegionConfiguration => {
        let region: RbsRegionConfiguration | undefined = undefined

        if (this.clientConfig!.regionConfiguration) {
            region = this.clientConfig!.regionConfiguration
        } else {
            region = RbsRegions.find(r => r.regionId === this.clientConfig!.region)
            if (!region) {
                region = RbsRegions.find(r => r.regionId === RbsRegion.euWest1)
            }
        }

        if (!region) throw new Error('Invalid rbs region')

        return region
    }

    private getApiUrl = (): string => {
        const region = this.getRegion()
        return `https://root.${region.apiUrl}`
    }

    private getBaseUrl = (action: string): string => {
        const region = this.getRegion()

        if (action.includes('.get.')) {
            return region.getUrl
        } else {
            return region.url
        }
    }

    private constructor() {}

    public static clearTokens() {
        if (typeof document != 'undefined') {
            // I'm on the web!
            // Browser environment
            for (var key in localStorage) {
                if (key.startsWith(RBS_TOKENS_KEY)) localStorage.removeItem(key)
            }
        }
    }

    public static getInstance(config: RBSClientConfig | null = null): RBS {
        if (!RBS.instances) RBS.instances = []
        let instance = RBS.instances.find(i => i.clientConfig?.projectId === config?.projectId)
        if (!instance) {
            instance = new RBS()
            if (config) {
                instance.init(config)
            }
            RBS.instances.push(instance)
        }

        return instance
    }

    public static dispose() {
        RBS.instances = []
    }

    init(config: RBSClientConfig) {
        if (this.initialized) throw new Error('RBS SDK already initialized.')
        this.initialized = true

        const axiosRequestConfiguration: AxiosRequestConfig = {
            responseType: 'json',
            headers: {
                'Content-Type': 'application/json',
            },
            timeout: 30000,
        }

        this.axiosInstance = initializeAxios(axiosRequestConfiguration)

        config.logLevel ? log.setLevel(config.logLevel) : log.setLevel('ERROR')

        this.clientConfig! = config

        if (!this.clientConfig!.region) this.clientConfig!.region = RbsRegion.euWest1

        let incomingAction = this.commandQueue.asObservable()

        let actionResult = incomingAction.pipe(
            concatMap(async action => {
                let actionWrapper: RBSActionWrapper = {
                    action,
                }

                return await this.getActionWithTokenData(actionWrapper)
            }),
            tap(actionWrapper => {
                this.fireAuthStatus(actionWrapper.tokenData)
            }),
            filter(actionWrapper => actionWrapper.tokenData != null),
            tap(async actionWrapper => {
                await this.setTokenData(actionWrapper.tokenData!)
            }),
            mergeMap(ev => {
                let endpoint = ev.tokenData!.isServiceToken ? '/service/action' : '/user/action'
                const action = ev.action!.action!
                const actionType = action.split('.')[2]
                endpoint = `${endpoint}/${this.clientConfig!.projectId}/${action}`

                endpoint = this.getBaseUrl(action) + this.getServiceEndpoint(ev)

                if (ev.action?.token) {
                    ev.tokenData!.accessToken = ev.action!.token
                }

                if (this.isCosAction(action)) {
                    const cosData = ev.action!.data! as RBSCloudObjectData

                    endpoint = this.getCosEndpoint(
                        action.split('.')[3],
                        cosData.classId,
                        cosData.key ? `${cosData.key.name}!${cosData.key.value}` : cosData.instanceId,
                        cosData.method
                    )

                    return defer(() => this.request(endpoint, ev)).pipe(materialize())
                }

                if (action !== 'signInAnonym') {
                    if (actionType === 'get') {
                        return defer(() => this.get(endpoint, ev)).pipe(materialize())
                    } else {
                        return defer(() => this.post(endpoint, ev)).pipe(materialize())
                    }
                }

                return defer(() => {}).pipe(materialize())
            }),
            share()
        )

        actionResult.pipe(filter(r => r.hasValue && r.kind === 'N')).subscribe(e => {
            if (e.value?.action?.onSuccess) {
                if (e.value.action.generateGetUrl) {
                    e.value.action.onSuccess(e.value.url)
                } else {
                    e.value.action.onSuccess(e.value?.response)
                }
            }
        })

        actionResult.pipe(filter(r => r.hasValue === false && r.kind === 'E')).subscribe(e => {
            if (e.error) {
                let actionWrapper: RBSActionWrapper = e.error
                if (actionWrapper.action?.onError) {
                    actionWrapper.action?.onError(actionWrapper.responseError)
                }
            }
        })

        // Custom auth

        let customAuthResult = this.customAuthQueue.pipe(
            concatMap(action => {
                let actionWrapper: RBSActionWrapper = {
                    action,
                }
                return defer(() => {
                    const url = `${this.getApiUrl()}/CALL/ProjectUser/authWithCustomToken/${this.clientConfig!.projectId}_${action.data.userId}`
                    return this.getPlain(url, { customToken: action.data.token }, actionWrapper)
                }).pipe(materialize())
            }),

            share()
        )

        customAuthResult
            .pipe(
                filter(r => r.hasValue && r.kind === 'N'),
                map(e => {
                    let actionWrapper = e.value!
                    actionWrapper.tokenData = {
                        accessToken: actionWrapper.response.data.accessToken,
                        refreshToken: actionWrapper.response.data.refreshToken,
                        isServiceToken: false,
                        accessTokenExpiresAt: 0,
                        refreshTokenExpiresAt: 0,
                    }

                    if (actionWrapper.response.data.firebase) {
                        actionWrapper.tokenData.firebase = {
                            apiKey: actionWrapper.response.data.firebase.apiKey,
                            projectId: actionWrapper.response.data.firebase.projectId,
                            customToken: actionWrapper.response.data.firebase.customToken,
                        }
                    }
                    return actionWrapper
                }),
                tap(async actionWrapper => {
                    if (actionWrapper.tokenData) {
                        await this.setTokenData(actionWrapper.tokenData)
                    }
                    this.fireAuthStatus(actionWrapper.tokenData)
                }),
                tap(async () => await this.cleanInitFirebase())
            )
            .subscribe(async actionWrapper => {
                let authEvent = this.getAuthChangedEvent(await this.getStoredTokenData())
                if (actionWrapper.action!.onSuccess) {
                    actionWrapper.action!.onSuccess(authEvent)
                }
            })

        customAuthResult.pipe(filter(r => r.hasValue === false && r.kind === 'E')).subscribe(e => {
            if (e.error) {
                let actionWrapper: RBSActionWrapper = e.error
                if (actionWrapper.action?.onError) {
                    actionWrapper.action?.onError({
                        authStatus: RBSAuthStatus.AUTH_FAILED,
                        message: actionWrapper.responseError,
                    })
                }
            }
        })

        this.authStatus.subscribe()

        setTimeout(async () => {
            this.fireAuthStatus(await this.getStoredTokenData())
        }, 1)
    }

    getAuthChangedEvent = (tokenData: RBSTokenData | undefined): RBSAuthChangedEvent => {
        if (!tokenData) {
            return {
                authStatus: RBSAuthStatus.SIGNED_OUT,
            }
        } else {
            const data: RbsJwtPayload = jwtDecode<RbsJwtPayload>(tokenData!.accessToken)

            if (data.anonymous) {
                return {
                    authStatus: RBSAuthStatus.SIGNED_IN_ANONYM,
                    uid: data.userId,
                    identity: data.identity,
                }
            } else {
                return {
                    authStatus: RBSAuthStatus.SIGNED_IN,
                    uid: data.userId,
                    identity: data.identity,
                }
            }
        }
    }

    fireAuthStatus = (tokenData: RBSTokenData | undefined) => {
        const event = this.getAuthChangedEvent(tokenData)
        log.info('RBSSDK LOG: fireAuthStatus event:', event)
        this.authStatusSubject.next(event)
    }

    _getStoredTokenData = async (): Promise<RBSTokenData | undefined> => {
        let storedTokenData: RBSTokenData | undefined

        if (typeof document != 'undefined') {
            // I'm on the web!
            // Browser environment
            let item = localStorage.getItem(this.getTokenDataKey())
            if (item) {
                storedTokenData = JSON.parse(item)
            }
        } else if (typeof navigator != 'undefined' && navigator.product == 'ReactNative') {
            // I'm in react-native
            let item = await AsyncStorage.getItem(this.getTokenDataKey())
            if (item) {
                storedTokenData = JSON.parse(item)
            }
        } else {
            // I'm in node js
            // Node environment
            storedTokenData = this.latestTokenData
        }

        return storedTokenData
    }

    logMessage = (logMessage: LogMessage) => {}

    getActionWithTokenData = (actionWrapper: RBSActionWrapper): Promise<RBSActionWrapper> => {
        return new Promise(async (resolve, reject) => {
            log.info('RBSSDK LOG: getActionWithTokenData started')

            log.info('RBSSDK LOG: secretKey and serviceId not found')

            let now = this.getSafeNow()

            log.info('RBSSDK LOG: now:', now)

            let storedTokenData: RBSTokenData | undefined = await this._getStoredTokenData()

            log.info('RBSSDK LOG: storedTokenData:', storedTokenData)

            if (storedTokenData) {
                log.info('RBSSDK LOG: storedTokenData is defined')

                const accessTokenExpiresAt = jwtDecode<RbsJwtPayload>(storedTokenData.accessToken).exp || 0
                const refreshTokenExpiresAt = jwtDecode<RbsJwtPayload>(storedTokenData.refreshToken).exp || 0

                // If token doesn't need refreshing return it.
                if (refreshTokenExpiresAt > now && accessTokenExpiresAt > now) {
                    log.info('RBSSDK LOG: returning same token')
                    // Just return same token
                    actionWrapper.tokenData = storedTokenData
                }

                // If token needs refreshing, refresh it.
                if (refreshTokenExpiresAt > now && accessTokenExpiresAt <= now) {
                    // now + 280 -> only wait 20 seconds for debugging
                    // Refresh token
                    log.info('RBSSDK LOG: token refresh needed')
                    try {
                        const url = `${this.getApiUrl()}/CALL/ProjectUser/refreshToken/${this.clientConfig!.projectId}`
                        console.log('RBSSDK LOG: url:', url)
                        actionWrapper.tokenData = await this.getP<RBSTokenData>(url, {
                            refreshToken: storedTokenData.refreshToken,
                        })
                        if (!this.firebaseApp) await this.initFirebase()
                    } catch (err) {
                        this.signOut()
                    }

                    log.info('RBSSDK LOG: refreshed tokenData:', actionWrapper.tokenData)
                }
            } else {
                log.info('RBSSDK LOG: getting anonym token')

                // Get anonym token
                const url = `${this.getApiUrl()}/INSTANCE/ProjectUser`

                let params: any = {
                    projectId: this.clientConfig!.projectId,
                }

                actionWrapper.tokenData = (await this.getP<{ response: RBSTokenData }>(url, params)).response
                if (!this.firebaseApp) await this.initFirebase()

                log.info('RBSSDK LOG: fetched anonym token:', actionWrapper.tokenData)
            }

            log.info('RBSSDK LOG: resolving with actionWrapper:', actionWrapper)

            resolve(actionWrapper)
        })
    }

    getP = async <T>(url: string, queryParams?: object): Promise<T> => {
        return (await this.axiosInstance!.get<T>(url, { params: queryParams })).data
    }

    getPlatform = (): string => {
        return this.clientConfig?.platform ? this.clientConfig.platform : 'WEB'
    }

    request = async (url: string, actionWrapper: RBSActionWrapper): Promise<RBSActionWrapper> => {
        const data = actionWrapper.action?.data as RBSCloudObjectCallData

        const params: any = {
            _token: actionWrapper.tokenData?.accessToken,
        }

        for (let key in data.querystring || []) {
            params[key] = data.querystring![key]
        }

        try {
            if (!this.axiosInstance) throw new Error('Axios instance is null')
            const { config, request, ...response } = await this.axiosInstance({
                url: url,
                method: data.httpMethod ?? 'post',
                params,
                data: data.payload,
                headers: { ...data.headers, accept: 'text/plain', 'Content-Type': 'text/plain' },
            })

            actionWrapper.response = response
            return actionWrapper
        } catch (error: any) {
            actionWrapper.response = error.response
            actionWrapper.responseError = error
            throw actionWrapper
        }
    }

    post = (url: string, actionWrapper: RBSActionWrapper): Promise<RBSActionWrapper> => {
        return new Promise((resolve, reject) => {
            let params: any = {
                auth: actionWrapper.tokenData?.accessToken,
            }
            let data = actionWrapper.action?.data

            if (actionWrapper.action?.targetServiceId) {
                params.targetServiceId = actionWrapper.action?.targetServiceId
            }
            if (actionWrapper.action?.relatedUserId) {
                params.relatedUserId = actionWrapper.action?.relatedUserId
            }
            if (actionWrapper.action?.headers) {
                params.headers = base64Helpers.urlEncode(JSON.stringify(actionWrapper.action?.headers))
            }
            if (actionWrapper.action?.culture) {
                params.culture = actionWrapper.action.culture
            }

            if (actionWrapper.action?.pop) {
                params.pop = 'true'
            }

            params.platform = this.getPlatform()

            this.axiosInstance!.post(url, data, {
                params,
            })
                .then(resp => {
                    actionWrapper.response = resp.data
                    resolve(actionWrapper)
                })
                .catch(err => {
                    actionWrapper.responseError = err
                    reject(actionWrapper)
                })
        })
    }

    getParams = (actionWrapper: RBSActionWrapper): any => {
        let params: any = {
            auth: actionWrapper.tokenData?.accessToken,
        }
        if (actionWrapper.action?.data) {
            const data = actionWrapper.action?.data ? actionWrapper.action?.data : {}
            params.data = base64Helpers.urlEncode(JSON.stringify(data))
        }
        if (actionWrapper.action?.targetServiceId) {
            params.targetServiceId = actionWrapper.action?.targetServiceId
        }
        if (actionWrapper.action?.relatedUserId) {
            params.relatedUserId = actionWrapper.action?.relatedUserId
        }
        if (actionWrapper.action?.headers) {
            params.headers = base64Helpers.urlEncode(JSON.stringify(actionWrapper.action?.headers))
        }
        if (actionWrapper.action?.culture) {
            params.culture = actionWrapper.action.culture
        }

        if (actionWrapper.action?.pop) {
            params.pop = 'true'
        }

        params.platform = this.getPlatform()

        return params
    }

    get = (url: string, actionWrapper: RBSActionWrapper): Promise<RBSActionWrapper> => {
        return new Promise((resolve, reject) => {
            let params = this.getParams(actionWrapper)

            if (actionWrapper.action?.generateGetUrl) {
                // Don't get from server but just return get url
                let url = this.getBaseUrl(actionWrapper.action.action!) + this.getServiceEndpoint(actionWrapper) + '?'

                for (let k of Object.keys(params)) {
                    url = `${url}${k}=${params[k]}&`
                }

                actionWrapper.url = url
                resolve(actionWrapper)
            } else {
                this.axiosInstance!.get(url, {
                    params,
                    headers: {
                        ['Content-Type']: 'text/plain',
                        ...actionWrapper.action?.headers,
                    },
                })
                    .then(resp => {
                        actionWrapper.response = resp.data
                        resolve(actionWrapper)
                    })
                    .catch(err => {
                        actionWrapper.responseError = err
                        reject(actionWrapper)
                    })
            }
        })
    }

    getPlain = (url: string, params: any, actionWrapper: RBSActionWrapper): Promise<RBSActionWrapper> => {
        return new Promise((resolve, reject) => {
            this.axiosInstance!.get(url, {
                params,
            })
                .then(resp => {
                    actionWrapper.response = resp
                    resolve(actionWrapper)
                })
                .catch(err => {
                    actionWrapper.responseError = err
                    reject(actionWrapper)
                })
        })
    }

    getSafeNow = (): number => {
        return Math.round(new Date().getTime() / 1000) + 30 // Plus 30 seconds, just in case.
    }

    getTokenDataKey = (): string => {
        return `${RBS_TOKENS_KEY}.${this.clientConfig?.projectId}`
    }

    setTokenData = async (tokenData: RBSTokenData) => {
        if (typeof document != 'undefined') {
            // I'm on the web!
            // Browser environment
            localStorage.setItem(this.getTokenDataKey(), JSON.stringify(tokenData))
        } else if (typeof navigator != 'undefined' && navigator.product == 'ReactNative') {
            // I'm in react-native
            await AsyncStorage.setItem(this.getTokenDataKey(), JSON.stringify(tokenData))
        } else {
            // I'm in node js
            // Node environment
            this.latestTokenData = tokenData
        }
    }

    // PUBLIC METHODS

    public getStoredTokenData = async (): Promise<RBSTokenData | undefined> => {
        if (typeof document != 'undefined') {
            // I'm on the web!
            // Browser environment
            const storedTokenData = localStorage.getItem(this.getTokenDataKey())
            if (storedTokenData) {
                const data: RBSTokenData = JSON.parse(storedTokenData)
                const accessTokenExpiresAt = jwtDecode<RbsJwtPayload>(data.accessToken).exp || 0
                const refreshTokenExpiresAt = jwtDecode<RbsJwtPayload>(data.refreshToken).exp || 0
                data.accessTokenExpiresAt = accessTokenExpiresAt
                data.refreshTokenExpiresAt = refreshTokenExpiresAt
                return data
            } else {
                return undefined
            }
        } else if (typeof navigator != 'undefined' && navigator.product == 'ReactNative') {
            // I'm in react-native
            let storedTokenData = await AsyncStorage.getItem(this.getTokenDataKey())
            if (storedTokenData) {
                const data: RBSTokenData = JSON.parse(storedTokenData)
                const accessTokenExpiresAt = jwtDecode<RbsJwtPayload>(data.accessToken).exp || 0
                const refreshTokenExpiresAt = jwtDecode<RbsJwtPayload>(data.refreshToken).exp || 0
                data.accessTokenExpiresAt = accessTokenExpiresAt
                data.refreshTokenExpiresAt = refreshTokenExpiresAt
                return data
            } else {
                return undefined
            }
        } else {
            // Node environment
            return this.latestTokenData
        }
    }

    public getUser = async (): Promise<RbsJwtPayload | null> => {
        let tokenData = await this.getStoredTokenData()
        if (!tokenData) return null
        return jwtDecode<RbsJwtPayload>(tokenData.accessToken)
    }

    public generatePublicGetActionUrl = (action: RBSAction): string => {
        let actionWrapper: RBSActionWrapper = {
            action,
            tokenData: {
                isServiceToken: false,
                accessToken: '',
                refreshToken: '',
                accessTokenExpiresAt: 0,
                refreshTokenExpiresAt: 0,
            },
        }

        let params = this.getParams(actionWrapper)

        // Don't get from server but just return get url
        let url = this.getBaseUrl(actionWrapper.action!.action!) + this.getServiceEndpoint(actionWrapper) + '?'

        for (let k of Object.keys(params)) {
            url = `${url}${k}=${params[k]}&`
        }

        return url
    }

    public generateGetActionUrl = (action: RBSAction): Promise<string> => {
        if (!this.initialized) throw new Error('RBS SDK is not initialized')

        if (!action.culture) action.culture = 'en-US'

        return new Promise((resolve, reject) => {
            if (!action.onSuccess && !action.onError) {
                action.onSuccess = resolve
                action.onError = reject
            }
            action.generateGetUrl = true
            this.commandQueue.next(action)
        })
    }

    public send = (action: RBSAction): Promise<ServiceResponse[] | any> => {
        if (!this.initialized) throw new Error('RBS SDK is not initialized')

        if (!action.culture) action.culture = 'en-US'

        return new Promise((resolve, reject) => {
            if (!action.onSuccess && !action.onError) {
                action.onSuccess = resolve
                action.onError = reject
            }
            this.commandQueue.next(action)
        })
    }

    public authenticateWithCustomToken = (userId: string, token: string): Promise<RBSAuthChangedEvent> => {
        if (!this.initialized) throw new Error('RBS SDK is not initialized')

        return new Promise((resolve, reject) => {
            let action = {
                action: 'customauth', // this string is not used here.
                data: {
                    userId,
                    token,
                },

                onSuccess: resolve,
                onError: reject,
            }

            this.customAuthQueue.next(action)
        })
    }

    public signInAnonymously = async (): Promise<void> => {
        await this.send({
            action: 'signInAnonym',
            data: {},
        })
    }

    public signOut = async (): Promise<boolean> => {
        if (!this.initialized) throw new Error('RBS SDK is not initialized')

        if (typeof document != 'undefined') {
            localStorage.removeItem(this.getTokenDataKey())
        } else if (typeof navigator != 'undefined' && navigator.product == 'ReactNative') {
            await AsyncStorage.removeItem(this.getTokenDataKey())
        } else {
            this.latestTokenData = undefined
        }

        this.fireAuthStatus(await this.getStoredTokenData())
        await this.cleanInitFirebase()

        this.logoutUser()

        return true
    }

    protected logoutUser = async (): Promise<boolean> => {
        return new Promise(async (resolve, reject) => {
            let tokenData = await this.getStoredTokenData()
            let endpoint = `${this.getApiUrl()}/CALL/ProjectUser/signOut/${this.clientConfig!.projectId}`

            try {
                await this.getP(endpoint, {
                    accessToken: tokenData?.accessToken,
                })
            } catch (err) {}

            resolve(true)
        })
    }

    protected initFirebase = async (): Promise<void> => {
        const firebaseConfig = (await this.getStoredTokenData())?.firebase
        console.log({firebaseConfig})
        if (!firebaseConfig) return

        if (!this.firebaseApp) {
            this.firebaseApp = initializeApp({
                apiKey: firebaseConfig.apiKey,
                authDomain: firebaseConfig.projectId + '.firebaseapp.com',
                projectId: firebaseConfig.projectId,
            })
            this.firestore = getFirestore(this.firebaseApp)
            this.firebaseAuth = getAuth(this.firebaseApp)

            await signInWithCustomToken(this.firebaseAuth!, firebaseConfig.customToken)
        }
    }

    private getFirebaseListeners = async (data: RBSCloudObjectData, queue: ReplaySubject<any>, key: keyof RBSCloudObjectStates): Promise<Unsubscribe | null> => {
        const userData = await this.getUser()
        console.log({userData})

        if (!userData && key !== 'public') return null
        let documentId = data.instanceId!

        let collection = `/projects/${this.clientConfig!.projectId}/classes/${data.classId}/instances`
        if (key === 'role') {
            documentId = userData!.identity!
            collection += `/${data.instanceId}/roleState`
        }
        if (key === 'user') {
            documentId = userData!.userId!
            collection += `/${data.instanceId}/userState`
        }
        console.log(collection, documentId)

        const document = doc(this.firestore!, collection, documentId)

        const unsubscribe = onSnapshot(document, doc => {
            const data = Object.assign({}, doc.data())
            for (const key of Object.keys(data)) {
                if (key.startsWith('__')) delete data[key]
            }
            queue.next(data)
        })

        return unsubscribe
    }

    private cleanInitFirebase = async () => {
        // unsubscribe from all events
        this.cloudObjects.map((cloudObject: RBSCloudObjectItem) => {
            cloudObject.unsubscribers.map(unsubscribe => unsubscribe && unsubscribe())
        })
        this.cloudObjects = []
        if (this.firebaseAuth) await signOut(this.firebaseAuth!)
        this.firebaseApp = null
        this.firestore = null
        this.firebaseAuth = null
    }

    private isCosAction = (action: string): boolean => {
        return ['rbs.core.request.INSTANCE', 'rbs.core.request.CALL', 'rbs.core.request.STATE'].includes(action)
    }

    private getCosEndpoint = (method: string, classId: string, instanceId?: string, methodId?: string): string => {
        const region = this.getRegion()
        return `https://${this.clientConfig!.projectId}.${region.apiUrl}/${method}/${classId}${methodId ? '/' + methodId : ''}${instanceId ? '/' + instanceId : ''}`
    }

    public getCloudObject = async (data: RBSCloudObjectData): Promise<RBSCloudObject> => {
        if (data.useLocal && data.instanceId) {
            return {
                instanceId: data.instanceId,
                isNewInstance: true,
                methods: [],
                getState: async (params?: RBSCloudObjectRequest) => {
                    return await this.send({
                        action: 'rbs.core.request.STATE',
                        data: {
                            ...params,
                            classId: data.classId,
                            instanceId: data.instanceId,
                        },
                        token: params?.token,
                    })
                },
                call: async (params: RBSCloudObjectCallData) => {
                    return await this.send({
                        action: 'rbs.core.request.CALL',
                        data: {
                            ...params,
                            classId: data.classId,
                            instanceId: data.instanceId,
                        },
                        token: params.token,
                    })
                },
            }
        }

        const { data: instanceResponse } = await this.send({
            action: 'rbs.core.request.INSTANCE',
            data,
            token: data.token,
        })

        if (!this.firebaseApp) {
            await this.initFirebase()
        }
        if (instanceResponse?.instanceId) data.instanceId = instanceResponse.instanceId

        let seekedObject = this.cloudObjects.find(cloudObject => cloudObject.config.classId === data.classId && cloudObject.config.instanceId === data.instanceId)
        if (seekedObject) {
            seekedObject.methods = instanceResponse?.methods // refresh methods.
            return {
                instanceId: seekedObject.config.instanceId!,
                call: seekedObject.call,
                state: seekedObject.state,
                getState: seekedObject.getState,
                methods: seekedObject.methods || [],
                isNewInstance: seekedObject.isNewInstance,
            }
        }

        const queues = {
            roleQueue: new ReplaySubject<any>(1),
            userQueue: new ReplaySubject<any>(1),
            publicQueue: new ReplaySubject<any>(1),
        }

        const state = {
            role: queues.roleQueue.asObservable(),
            user: queues.userQueue.asObservable(),
            public: queues.publicQueue.asObservable(),
        }

        const unsubscribers = []
        unsubscribers.push(await this.getFirebaseListeners(data, queues.roleQueue, 'role'))
        unsubscribers.push(await this.getFirebaseListeners(data, queues.userQueue, 'user'))
        unsubscribers.push(await this.getFirebaseListeners(data, queues.publicQueue, 'public'))

        const call = async (params: RBSCloudObjectCallData) => {
            return await this.send({
                action: 'rbs.core.request.CALL',
                data: {
                    ...params,
                    classId: data.classId,
                    instanceId: data.instanceId,
                },
                token: params.token,
            })
        }

        const getState = async (params?: RBSCloudObjectRequest) => {
            return await this.send({
                action: 'rbs.core.request.STATE',
                data: {
                    ...params,
                    classId: data.classId,
                    instanceId: data.instanceId,
                },
                token: params?.token,
            })
        }

        this.cloudObjects.push({
            config: data,
            isNewInstance: instanceResponse?.newInstance ?? false,
            methods: instanceResponse?.methods,
            call,
            state,
            getState,
            unsubscribers,
        })

        return { instanceId: data.instanceId!, state, call, getState, isNewInstance: instanceResponse?.newInstance ?? false, methods: instanceResponse?.methods || [] }
    }
}
