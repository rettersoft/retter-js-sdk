import { Unsubscribe } from '@firebase/util'
import { getFirestore } from 'firebase/firestore'
import { FirebaseApp, initializeApp } from 'firebase/app'
import { doc, Firestore, onSnapshot } from 'firebase/firestore'
import { Auth, getAuth, signInWithCustomToken, signOut } from 'firebase/auth'
import { defer, Notification, Observable, of, ReplaySubject, Subject } from 'rxjs'
import { concatMap, distinctUntilChanged, filter, map, materialize, mergeMap, share, tap } from 'rxjs/operators'

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
} from './types'

export * from './types'

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

    private constructor() {}

    public static getInstance(config: RetterClientConfig): Retter {
        const instance = Retter.instances.find(instance => instance.clientConfig?.projectId === config.projectId)
        if (instance) return instance

        const newInstance = new Retter()
        newInstance.init(config)
        Retter.instances.push(newInstance)

        return newInstance
    }

    protected init(config: RetterClientConfig) {
        if (this.initialized) throw new Error('SDK already initialized.')
        this.initialized = true
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
                tap(this.storeTokenData.bind(this)),
                tap(async ev => {
                    await this.clearCloudObjects()
                    if (ev.tokenData) {
                        this.initFirebase(ev)
                    }
                }),
                tap(this.fireAuthStatus.bind(this))
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
            // // Fire auth status event
            tap(this.fireAuthStatus.bind(this)),
            // // Make sure we have a token
            filter(ev => ev.tokenData !== null),
            // // Store token data
            tap(this.storeTokenData.bind(this)),
            // // Process action
            mergeMap(this.processAction.bind(this)),
            share()
        )

        actionResult.pipe(filter(r => r.hasValue && r.kind === 'N')).subscribe(e => {
            if (e.value && e.value.action && e.value.action.resolve && e.value.response) {
                e.value.action.resolve(e.value.response)
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
            this.signOut()
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
        if (actionWrapper.action?.action === RetterActions.SIGN_IN_ANONYM) {
            return defer(() => of({ ...actionWrapper, response: this.auth!.getAuthStatus(actionWrapper.tokenData) })).pipe(materialize())
        }

        return defer(async () => {
            const endpoint = this.getCosEndpoint(actionWrapper.action!)
            const response = await this.http!.call(this.clientConfig!.projectId, endpoint.path, endpoint.params)
            return { ...actionWrapper, response }
        }).pipe(materialize())
    }

    // Firebase
    protected async initFirebase(actionWrapper: RetterActionWrapper) {
        const firebaseConfig = actionWrapper.tokenData?.firebase
        if (!firebaseConfig || !!this.firebase) return actionWrapper

        this.firebase = initializeApp({
            apiKey: firebaseConfig.apiKey,
            authDomain: firebaseConfig.projectId + '.firebaseapp.com',
            projectId: firebaseConfig.projectId,
        })

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
    protected getCosEndpoint(action: RetterAction): { path: string; params: any } {
        const data = action.data as RetterCloudObjectConfig
        if (action.action === RetterActions.COS_INSTANCE) {
            const instanceId = data.key ? `${data.key.name}!${data.key.value}` : data.instanceId
            return {
                path: `INSTANCE/${data.classId}${data.instanceId ? `/${instanceId}` : ''}`,
                params: {},
            }
        } else if (action.action === RetterActions.COS_STATE) {
            return {
                path: `STATE/${data.classId}/${data.instanceId}`,
                params: {},
            }
        } else {
            return {
                path: `CALL/${data.classId}/${data.method}/${data.instanceId}`,
                params: {},
            }
        }
    }

    protected getFirebaseListener(queue: ReplaySubject<any>, collection: string, documentId: string): Unsubscribe {
        const document = doc(this.firestore!, collection, documentId)
        console.log('document', document)

        return onSnapshot(document, doc => {
            const data = Object.assign({}, doc.data())
            for (const key of Object.keys(data)) {
                if (key.startsWith('__')) delete data[key]
            }
            queue.next(data)
        })
    }

    protected async clearCloudObjects() {
        this.cloudObjects.map(i => i.unsubscribers.map(u => u()))
        this.cloudObjects = []
        if (this.firebaseAuth) await signOut(this.firebaseAuth!)
        this.clearFirebase()
    }

    // Public Methods
    public async signInAnonymously(): Promise<RetterAuthChangedEvent> {
        if (!this.initialized) throw new Error('Retter SDK not initialized.')
        return await this.sendToActionQueue<RetterAuthChangedEvent>({ action: RetterActions.SIGN_IN_ANONYM })
    }

    public async authenticateWithCustomToken(token: string): Promise<RetterAuthChangedEvent> {
        if (!this.initialized) throw new Error('Retter SDK not initialized.')

        return await this.sendToAuthQueue<RetterAuthChangedEvent>({ action: RetterActions.SIGN_IN, data: token })
    }

    public async signOut(): Promise<void> {
        if (!this.initialized) throw new Error('Retter SDK not initialized.')

        await this.clearCloudObjects()
        await this.auth!.clearTokenData()
        // Fire auth status after all tokens cleared
        this.fireAuthStatus({})

        // dont wait for sign out to finish
        this.auth!.signOut()
    }

    public async getCloudObject<T>(config: RetterCloudObjectConfig): Promise<RetterCloudObject<T>> {
        if (!this.initialized) throw new Error('Retter SDK not initialized.')

        const instance = await this.sendToActionQueue<any>({ action: RetterActions.COS_INSTANCE, data: config })
        config.instanceId = instance.instanceId

        if (config.useLocal && config.instanceId) {
            return {
                call: async <T>(params: RetterCloudObjectCall): Promise<RetterCallResponse<T>> => {
                    return await this.sendToActionQueue<RetterCallResponse<T>>({
                        action: RetterActions.COS_CALL,
                        data: { ...params, classId: config.classId, instanceId: config.instanceId },
                    })
                },
                getState: async (params?: RetterCloudObjectRequest): Promise<RetterCallResponse<RetterCloudObjectState>> => {
                    return await this.sendToActionQueue<RetterCallResponse<RetterCloudObjectState>>({
                        action: RetterActions.COS_STATE,
                        data: { ...params, classId: config.classId, instanceId: config.instanceId },
                    })
                },
                methods: [],
                instanceId: config.instanceId!,
                isNewInstance: false,
            }
        }

        const seekedObject = this.cloudObjects.find(r => r.config.classId === config.classId && r.config.instanceId === r.instanceId)
        if (seekedObject) {
            return {
                call: seekedObject.call,
                state: seekedObject.state,
                getState: seekedObject.getState,
                methods: instance.methods,
                instanceId: config.instanceId!,
                isNewInstance: false,
            }
        }

        const roleQueue = new ReplaySubject(1)
        const userQueue = new ReplaySubject(1)
        const publicQueue = new ReplaySubject(1)

        const state = {
            role: roleQueue.asObservable(),
            user: userQueue.asObservable(),
            public: publicQueue.asObservable(),
        }

        const { projectId } = this.clientConfig!
        const user = await this.auth!.getCurrentUser()

        const unsubscribers: Unsubscribe[] = []
        unsubscribers.push(this.getFirebaseListener(publicQueue, `/projects/${projectId}/classes/${config.classId}/instances`, config.instanceId!))
        unsubscribers.push(this.getFirebaseListener(userQueue, `/projects/${projectId}/classes/${config.classId}/instances/${config.instanceId}/userState`, user!.userId!))
        unsubscribers.push(this.getFirebaseListener(roleQueue, `/projects/${projectId}/classes/${config.classId}/instances/${config.instanceId}/roleState`, user!.identity!))

        const call = async <T>(params: RetterCloudObjectCall): Promise<RetterCallResponse<T>> => {
            return await this.sendToActionQueue<RetterCallResponse<T>>({
                action: RetterActions.COS_CALL,
                data: { ...params, classId: config.classId, instanceId: config.instanceId },
            })
        }

        const getState = async (params?: RetterCloudObjectRequest): Promise<RetterCallResponse<RetterCloudObjectState>> => {
            return await this.sendToActionQueue<RetterCallResponse<RetterCloudObjectState>>({
                action: RetterActions.COS_STATE,
                data: { ...params, classId: config.classId, instanceId: config.instanceId },
            })
        }

        const retVal = {
            call,
            state,
            getState,
            methods: instance.methods,
            instanceId: config.instanceId!,
            isNewInstance: instance.isNewInstance ?? false,
        }

        this.cloudObjects.push({ ...retVal, config, unsubscribers })

        return retVal
    }

    public get authStatus(): Observable<RetterAuthChangedEvent> {
        return this.authStatusSubject.asObservable().pipe(distinctUntilChanged((a, b) => a.authStatus === b.authStatus && a.identity === b.identity && a.uid === b.uid))
    }
}
