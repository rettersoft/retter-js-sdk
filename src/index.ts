import { FirebaseApp, initializeApp } from 'firebase/app'
import { doc, Firestore, FirestoreError, onSnapshot, getFirestore, Unsubscribe } from 'firebase/firestore'
import { Auth, getAuth, signInWithCustomToken, signOut } from 'firebase/auth'
import { defer, Notification, Observable, of, ReplaySubject, Subject } from 'rxjs'
import { concatMap, distinctUntilChanged, filter, map, materialize, mergeMap, share, switchMap, tap } from 'rxjs/operators'

import RetterAuth from './Auth'
import RetterRequest from './Request'
import {
    RetterAction,
    RetterActions,
    RetterActionWrapper,
    RetterAuthChangedEvent,
    RetterAuthStatus,
    RetterCallResponse,
    RetterClientConfig,
    RetterCloudObject,
    RetterCloudObjectCall,
    RetterCloudObjectConfig,
    RetterCloudObjectItem,
    RetterCloudObjectRequest,
    RetterCloudObjectState,
    RetterCloudObjectStaticCall,
    RetterStateError,
    RetterStateErrorHandler,
    RetterStateScope,
    RetterTokenPayload,
} from './types'

export * from './types'

const DEFAULT_RETRY_DELAY = 50 // in ms
const DEFAULT_RETRY_COUNT = 3
const DEFAULT_RETRY_RATE = 1.5

export default class Retter {
    private static instances: Retter[] = []

    private initialized: boolean = false

    private clientConfig?: RetterClientConfig

    private auth?: RetterAuth

    private http?: RetterRequest

    private authQueue = new Subject<any>()

    private actionQueue = new Subject<RetterAction>()

    private authStatusSubject = new ReplaySubject<RetterAuthChangedEvent>(1)

    private firebase?: FirebaseApp

    private firestore?: Firestore

    private firebaseAuth?: Auth

    private cloudObjects: RetterCloudObjectItem[] = []

    private listeners: { [key: string]: any } = {}

    private stateErrorSubject = new Subject<RetterStateError>()

    private constructor() {}

    public static getInstance(config: RetterClientConfig): Retter {
        const instance = Retter.instances.find(instance =>
          instance.clientConfig?.projectId === config.projectId &&
          instance.clientConfig?.instanceKey === config.instanceKey)
        if (instance) return instance

        const newInstance = new Retter()
        newInstance.init(config)
        Retter.instances.push(newInstance)

        return newInstance
    }

    protected init(config: RetterClientConfig) {
        if (this.initialized) throw new Error('SDK already initialized.')
        this.initialized = true

        if (!config.retryConfig) config.retryConfig = {}
        if (!config.retryConfig.delay) config.retryConfig.delay = DEFAULT_RETRY_DELAY
        if (!config.retryConfig.count) config.retryConfig.count = DEFAULT_RETRY_COUNT
        if (!config.retryConfig.rate) config.retryConfig.rate = DEFAULT_RETRY_RATE

        this.clientConfig = config

        this.auth! = new RetterAuth(config)
        this.http! = new RetterRequest(config)

        this.auth!.setHttp(this.http!)

        this.processAuthQueue()
        this.processActionQueue()

        setTimeout(async () => {
            const tokenData = await this.auth!.getCurrentTokenData()
            this.fireAuthStatus({ tokenData })
        }, 1)
    }

    protected processAuthQueue() {
        const authResult = this.authQueue.pipe(
            concatMap(action => {
                return defer(async () => {
                    try {
                        const response = await this.auth!.signIn(action.data)
                        return { action, response }
                    } catch (error) {
                        throw { action, responseError: error }
                    }
                }).pipe(materialize())
            }),
            share()
        )

        // on success
        authResult
            .pipe(
                filter(r => r.hasValue && r.kind === 'N'),
                map(e => ({ ...e.value, tokenData: e.value?.response })),
                switchMap(async ev => {
                    await this.storeTokenData(ev)
                    return ev
                }),
                switchMap(async ev => {
                    if (this.firebaseAuth) await signOut(this.firebaseAuth!)
                    this.clearFirebase()
                    if (ev.tokenData) {
                        await this.initFirebase(ev)
                    }
                    this.fireAuthStatus(ev)
                    return ev
                })
            )
            .subscribe(ev => {
                if (ev.action?.resolve) {
                    ev.action.resolve(this.auth?.getAuthStatus(ev.tokenData))
                }
            })

        // on error
        authResult.pipe(filter(r => r.hasValue === false && r.kind === 'E')).subscribe(e => {
            if (e.error && e.error.action && e.error.action.resolve) {
                const response: RetterAuthChangedEvent = {
                    authStatus: RetterAuthStatus.AUTH_FAILED,
                    message: e.error.responseError.response?.data,
                }
                e.error.action.resolve(response)
            }
        })

        this.authStatus.subscribe()
    }

    protected processActionQueue() {
        const actionResult = this.actionQueue.asObservable().pipe(
            // Get current token data if exists and store it in action
            concatMap(this.getActionWithTokenData.bind(this)),
            // Fire auth status event
            tap(this.fireAuthStatus.bind(this)),
            // Make sure we have a token
            filter(ev => ev.tokenData !== null),
            // Store token data
            switchMap(async ev => {
                await this.storeTokenData(ev)
                return ev
            }),
            // Process action
            mergeMap(this.processAction.bind(this)),
            share()
        )

        actionResult.pipe(filter(r => r.hasValue && r.kind === 'N')).subscribe(e => {
            if (e.value && e.value.action && e.value.action.resolve && e.value.response) {
                e.value.action.resolve(e.value.response)
            }
        })

        actionResult.pipe(filter(r => r.hasValue === false && r.kind === 'E')).subscribe(e => {
            if (e.error && e.error.action && e.error.action.reject && e.error.responseError) {
                e.error.action.reject(e.error.responseError)
            }
        })
    }

    //
    protected async sendToAuthQueue<T>(action: RetterAction): Promise<T> {
        return new Promise((resolve, reject) => {
            this.authQueue.next({ ...action, reject, resolve })
        })
    }

    protected async sendToActionQueue<T>(action: RetterAction): Promise<T> {
        return new Promise((resolve, reject) => {
            this.actionQueue.next({ ...action, reject, resolve })
        })
    }

    //
    protected async getActionWithTokenData(action: RetterAction): Promise<RetterActionWrapper> {
        try {
            const ev = { action, tokenData: await this.auth!.getTokenData() }
            await this.initFirebase(ev)
            return ev
        } catch (error: any) {
            await this.signOut()
            return { action }
        }
    }

    protected fireAuthStatus(actionWrapper: RetterActionWrapper) {
        const event = this.auth!.getAuthStatus(actionWrapper.tokenData)

        this.authStatusSubject.next(event)
    }

    protected async storeTokenData(actionWrapper: RetterActionWrapper) {
        await this.auth!.storeTokenData(actionWrapper.tokenData!)
    }

    protected processAction(actionWrapper: RetterActionWrapper): Observable<Notification<RetterActionWrapper>> {
        if (actionWrapper.action?.action === RetterActions.EMPTY) {
            return defer(() => of({ ...actionWrapper, response: true })).pipe(materialize())
        }

        return defer(async () => {
            try {
                const endpoint = this.getCosEndpoint(actionWrapper)

                const response = await this.http!.call(this.clientConfig!.projectId, endpoint.path, endpoint.params)
                return { ...actionWrapper, response }
            } catch (error: any) {
                if (
                    error.response &&
                    error.response.status === 403 &&
                    error.response.data &&
                    error.response.data.code === 'ACCESS_DENIED'
                ) {
                    this.signOut()
                }
                throw { ...actionWrapper, responseError: error }
            }
        }).pipe(materialize())
    }

    // Firebase
    protected async initFirebase(actionWrapper: RetterActionWrapper) {
        const firebaseConfig = actionWrapper.tokenData?.firebase
        if (!firebaseConfig || this.firebase) return actionWrapper

        this.firebase = initializeApp(
            {
                apiKey: firebaseConfig.apiKey,
                authDomain: firebaseConfig.projectId + '.firebaseapp.com',
                projectId: firebaseConfig.projectId,
            },
            this.clientConfig!.projectId
        )

        this.firestore = getFirestore(this.firebase!)
        this.firebaseAuth = getAuth(this.firebase!)

        await signInWithCustomToken(this.firebaseAuth!, firebaseConfig.customToken)

        return actionWrapper
    }

    protected clearFirebase() {
        this.firebase = undefined
        this.firestore = undefined
        this.firebaseAuth = undefined
    }

    // Cloud Objects
    protected getCosEndpoint(ev: RetterActionWrapper): { path: string; params: any } {
        const action = ev.action!
        const data = action.data as RetterCloudObjectConfig
        const queryParams: any = {}

        for (let key in data.queryStringParams || []) {
            queryParams[key] = data.queryStringParams![key]
        }

        queryParams['__culture'] = data.culture ?? (this.clientConfig?.culture || 'en-us')
        if (data.platform || this.clientConfig?.platform) {
            queryParams['__platform'] = data.platform ?? this.clientConfig?.platform
        }

        const params = {
            params: queryParams,
            method: data.httpMethod ?? 'post',
            data: data.body,
            base64Encode: data.base64Encode ?? true,
            headers: { ...data.headers },
        }

        const accessToken = data.token ?? ev.tokenData?.accessToken
        if (accessToken) {
            params.headers['Authorization'] = `Bearer ${accessToken}`
        }

        if (action.action === RetterActions.COS_INSTANCE) {
            const instanceId = data.key ? `${data.key.name}!${data.key.value}` : data.instanceId

            return {
                path: `INSTANCE/${data.classId}${instanceId ? `/${instanceId}` : ''}`,
                params,
            }
        } else if (action.action === RetterActions.COS_STATE) {
            return {
                path: `STATE/${data.classId}/${data.instanceId}`,
                params,
            }
        } else if (action.action === RetterActions.COS_LIST) {
            return {
                path: `LIST/${data.classId}`,
                params,
            }
        } else if (action.action === RetterActions.COS_STATIC_CALL) {
            return {
                path: `CALL/${data.classId}/${data.method}${data.pathParams ? `/${data.pathParams}` : ''}`,
                params,
            }
        } else {
            return {
                path: `CALL/${data.classId}/${data.method}/${data.instanceId}${data.pathParams ? `/${data.pathParams}` : ''}`,
                params,
            }
        }
    }

    /**
     * Single seam around Firestore so tests can stub the realtime channel without a real Firebase app.
     */
    protected createStateListener(
        collection: string,
        documentId: string,
        onNext: (data: { [key: string]: any }) => void,
        onError: (error: FirestoreError) => void
    ): Unsubscribe {
        const document = doc(this.firestore!, collection, documentId)
        return onSnapshot(document, snapshot => onNext(Object.assign({}, snapshot.data())), onError)
    }

    protected getFirebaseListener(
        queue: ReplaySubject<any>,
        errors: Subject<RetterStateError>,
        meta: { scope: RetterStateScope; classId: string; instanceId: string; listenerKey: string },
        collection: string,
        documentId: string
    ): Unsubscribe {
        return this.createStateListener(
            collection,
            documentId,
            data => {
                for (const key of Object.keys(data)) {
                    if (key.startsWith('__')) delete data[key]
                }
                queue.next(data)
            },
            error => {
                // Firestore closes the listener after an error; drop it so a later subscribe() re-attaches.
                delete this.listeners[meta.listenerKey]

                const stateError: RetterStateError = {
                    scope: meta.scope,
                    classId: meta.classId,
                    instanceId: meta.instanceId,
                    code: (error as any)?.code ?? 'unknown',
                    message: (error as any)?.message ?? String(error),
                    original: error,
                }
                errors.next(stateError)
                this.stateErrorSubject.next(stateError)
            }
        )
    }

    protected async getFirebaseState(config: RetterCloudObjectConfig) {
        const { projectId } = this.clientConfig!
        const user = await this.auth!.getCurrentUser()

        const unsubscribers: Unsubscribe[] = []

        const queues = {
            role: new ReplaySubject(1),
            user: new ReplaySubject(1),
            public: new ReplaySubject(1),
        }

        const errorQueues = {
            role: new Subject<RetterStateError>(),
            user: new Subject<RetterStateError>(),
            public: new Subject<RetterStateError>(),
        }

        const documentIds: { [scope in RetterStateScope]: () => string } = {
            role: () => user!.identity!,
            user: () => user!.userId!,
            public: () => config.instanceId!,
        }
        const collections: { [scope in RetterStateScope]: string } = {
            role: `/projects/${projectId}/classes/${config.classId}/instances/${config.instanceId}/roleState`,
            user: `/projects/${projectId}/classes/${config.classId}/instances/${config.instanceId}/userState`,
            public: `/projects/${projectId}/classes/${config.classId}/instances`,
        }

        const buildScope = (scope: RetterStateScope) => ({
            queue: queues[scope],
            subscribe: (observerOrNext?: any, error?: RetterStateErrorHandler) => {
                const listenerKey = `${projectId}_${config.classId}_${config.instanceId}_${scope}`
                if (!this.listeners[listenerKey]) {
                    const listener = this.getFirebaseListener(
                        queues[scope],
                        errorQueues[scope],
                        { scope, classId: config.classId, instanceId: config.instanceId!, listenerKey },
                        collections[scope],
                        documentIds[scope]()
                    )
                    unsubscribers.push(listener)
                    this.listeners[listenerKey] = listener
                }

                // Legacy behaviour: data queue never errors, so function-only subscribers are unaffected.
                const subscription = queues[scope].subscribe(observerOrNext)

                const errorHandler: RetterStateErrorHandler | undefined =
                    typeof error === 'function'
                        ? error
                        : observerOrNext && typeof observerOrNext === 'object' && typeof observerOrNext.error === 'function'
                        ? observerOrNext.error.bind(observerOrNext)
                        : undefined
                if (errorHandler) {
                    subscription.add(errorQueues[scope].subscribe(errorHandler))
                }

                return subscription
            },
        })

        const state = {
            role: buildScope('role'),
            user: buildScope('user'),
            public: buildScope('public'),
        }

        return { state, unsubscribers, errorQueues }
    }

    protected async clearCloudObjects() {
        // clear listeners
        const listeners = Object.values(this.listeners)
        if (listeners.length > 0) {
            listeners.map(i => i())

            this.cloudObjects.map(i => {
                i.state?.role.queue?.complete()
                i.state?.user.queue?.complete()
                i.state?.public.queue?.complete()
                i.errorQueues?.role.complete()
                i.errorQueues?.user.complete()
                i.errorQueues?.public.complete()
            })
        }
        this.listeners = {}

        this.cloudObjects.map(i => i.unsubscribers.map(u => u()))
        this.cloudObjects = []

        if (this.firebaseAuth) await signOut(this.firebaseAuth!)
        this.clearFirebase()
    }

    // Public Methods
    public async authenticateWithCustomToken(token: string): Promise<RetterAuthChangedEvent> {
        if (!this.initialized) throw new Error('Retter SDK not initialized.')

        return await this.sendToAuthQueue<RetterAuthChangedEvent>({ action: RetterActions.SIGN_IN, data: token })
    }

    public async signOut(): Promise<void> {
        if (!this.initialized) throw new Error('Retter SDK not initialized.')

        await this.clearCloudObjects()

        await this.auth!.signOut()
        await this.auth!.clearTokenData()

        // Fire auth status after all tokens cleared
        this.fireAuthStatus({})
    }

    public async getCurrentUser(): Promise<RetterTokenPayload | undefined> {
        return await this.auth!.getCurrentUser()
    }

    public async getCloudObject(config: RetterCloudObjectConfig): Promise<RetterCloudObject> {
        if (!this.initialized) throw new Error('Retter SDK not initialized.')

        let instance
        let instanceHeaders = {}

        if (config.instanceId && config.useLocal) {
            await this.sendToActionQueue({ action: RetterActions.EMPTY })
        } else {
            let { data, headers } = await this.sendToActionQueue<any>({ action: RetterActions.COS_INSTANCE, data: config })
            instance = data
            config.instanceId = instance.instanceId
            instanceHeaders = headers ?? {}
        }

        const seekedObject = this.cloudObjects.find(r => r.config.classId === config.classId && r.config.instanceId === config.instanceId)
        if (seekedObject) {
            return {
                call: seekedObject.call,
                state: seekedObject.state,
                listInstances: seekedObject.listInstances,
                getState: seekedObject.getState,
                init: instance?.init ?? {},
                get: instance?.get ?? {},
                methods: instance?.methods ?? [],
                instanceId: config.instanceId!,
                response: instance?.response ?? null,
                headers: instanceHeaders,
                isNewInstance: false,
            }
        }

        const { state, unsubscribers, errorQueues } = await this.getFirebaseState(config)

        const call = async <T>(params: RetterCloudObjectCall): Promise<RetterCallResponse<T>> => {
            params.retryConfig = { ...this.clientConfig!.retryConfig, ...params.retryConfig }
            try {
                return await this.sendToActionQueue<RetterCallResponse<T>>({
                    action: RetterActions.COS_CALL,
                    data: { ...params, classId: config.classId, instanceId: config.instanceId },
                })
            } catch (error: any) {
                --params.retryConfig.count!
                params.retryConfig.delay! *= params.retryConfig.rate!
                if (error.response && error.response.status === 570 && params.retryConfig.count! > 0) {
                    await new Promise(r => setTimeout(r, params.retryConfig!.delay!))
                    return await call(params)
                } else {
                    throw error
                }
            }
        }

        const getState = async (params?: RetterCloudObjectRequest): Promise<RetterCallResponse<RetterCloudObjectState>> => {
            return await this.sendToActionQueue<RetterCallResponse<RetterCloudObjectState>>({
                action: RetterActions.COS_STATE,
                data: { ...params, classId: config.classId, instanceId: config.instanceId },
            })
        }

        const listInstances = async (params?: RetterCloudObjectRequest): Promise<string[]> => {
            const { data } = await this.sendToActionQueue<RetterCallResponse<{ instanceIds: string[] }>>({
                action: RetterActions.COS_LIST,
                data: { ...params, classId: config.classId },
            })

            return data.instanceIds
        }

        const retVal = {
            call,
            state,
            getState,
            listInstances,
            init: instance?.init ?? {},
            get: instance?.get ?? {},
            methods: instance?.methods ?? [],
            response: instance?.response ?? null,
            headers: instanceHeaders,
            instanceId: config.instanceId!,
            isNewInstance: instance?.newInstance ?? false,
        }

        this.cloudObjects.push({ ...retVal, config, unsubscribers, errorQueues })

        return retVal
    }

    public async makeStaticCall<T>(params: RetterCloudObjectStaticCall): Promise<RetterCallResponse<T>> {
        if (!this.initialized) throw new Error('Retter SDK not initialized.')

        return await this.sendToActionQueue<RetterCallResponse<T>>({
            action: RetterActions.COS_STATIC_CALL,
            data: { ...params, classId: params.classId },
        })
    }

    /**
     * Instance-wide stream of realtime state listener errors across all cloud objects and scopes.
     * Complements the per-subscription `error` callback; never errors or completes on its own.
     */
    public get stateErrors(): Observable<RetterStateError> {
        return this.stateErrorSubject.asObservable()
    }

    public get authStatus(): Observable<RetterAuthChangedEvent> {
        return this.authStatusSubject.asObservable().pipe(distinctUntilChanged((a, b) => a.authStatus === b.authStatus && a.identity === b.identity && a.uid === b.uid))
    }
}
