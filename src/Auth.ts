import jwt from 'jwt-decode'
import AsyncStorage from '@react-native-async-storage/async-storage'

import { getRuntime } from './helpers'
import RetterRequest from './Request'
import { RetterAuthChangedEvent, RetterAuthStatus, RetterClientConfig, RetterTokenData, RetterTokenPayload } from './types'

export default class Auth {
    private http?: RetterRequest

    private clientConfig?: RetterClientConfig

    private rootProjectId?: string

    private tokenStorageKey?: string

    private currentTokenData?: RetterTokenData

    constructor(config: RetterClientConfig) {
        this.clientConfig = config
        this.tokenStorageKey = `RBS_TOKENS_KEY.${config.projectId}`

        this.rootProjectId = config.rootProjectId ?? 'root'
    }

    public setHttp(http: RetterRequest) {
        this.http = http
    }

    // Token
    public async storeTokenData(tokenData: RetterTokenData) {
        const runtime = getRuntime()
        if (runtime === 'web') {
            localStorage.setItem(this.tokenStorageKey!, JSON.stringify(tokenData))
        }
        if (runtime === 'react-native') {
            await AsyncStorage.setItem(this.tokenStorageKey!, JSON.stringify(tokenData))
        }
        this.currentTokenData = tokenData
    }

    public async clearTokenData(): Promise<void> {
        const runtime = getRuntime()
        if (runtime === 'web') {
            localStorage.removeItem(this.tokenStorageKey!)
        }
        if (runtime === 'react-native') {
            await AsyncStorage.removeItem(this.tokenStorageKey!)
        }
        this.currentTokenData = undefined
    }

    public async getCurrentTokenData(decoded: boolean = false): Promise<RetterTokenData | undefined> {
        let data: RetterTokenData | undefined
        const runtime = getRuntime()
        if (runtime === 'web') {
            const item = localStorage.getItem(this.tokenStorageKey!)
            if (item && item !== 'undefined') data = JSON.parse(item)
        } else if (runtime === 'react-native') {
            const item = await AsyncStorage.getItem(this.tokenStorageKey!)
            if (item && item !== 'undefined') data = JSON.parse(item)
        } else {
            data = this.currentTokenData
        }

        if (!decoded) return data
        if (data) {
            data.accessTokenDecoded = this.decodeToken(data.accessToken)
            data.refreshTokenDecoded = this.decodeToken(data.refreshToken)
        }

        return data
    }

    public async getCurrentUser(force: boolean = false): Promise<RetterTokenPayload | undefined> {
        const tokenData = force ? await this.getTokenData() : await this.getCurrentTokenData(true)
        return tokenData?.accessTokenDecoded
    }

    public async getTokenData(): Promise<RetterTokenData | undefined> {
        const tokenData = await this.getCurrentTokenData()
        if (tokenData) {
            const now = Math.round(new Date().getTime() / 1000) + 30 // Plus 30 seconds, just in case.

            tokenData.accessTokenDecoded = this.decodeToken(tokenData.accessToken)
            tokenData.refreshTokenDecoded = this.decodeToken(tokenData.refreshToken)

            const accessTokenExpiresAt = tokenData.accessTokenDecoded.exp ?? 0
            const refreshTokenExpiresAt = tokenData.refreshTokenDecoded.exp ?? 0

            // refresh token is valid, but access token is expired
            if (refreshTokenExpiresAt > now && accessTokenExpiresAt <= now) {
                const freshTokenData = await this.getFreshToken(tokenData.refreshToken, tokenData.refreshTokenDecoded.userId!)

                freshTokenData.accessTokenDecoded = this.decodeToken(freshTokenData.accessToken)
                freshTokenData.refreshTokenDecoded = this.decodeToken(freshTokenData.refreshToken)

                return freshTokenData
            }

            return tokenData
        } else {
            const anonymousTokenData = await this.getAnonymousToken()

            anonymousTokenData.accessTokenDecoded = this.decodeToken(anonymousTokenData.accessToken)
            anonymousTokenData.refreshTokenDecoded = this.decodeToken(anonymousTokenData.refreshToken)

            return anonymousTokenData
        }
    }

    protected decodeToken(token: string): RetterTokenPayload {
        return jwt<RetterTokenPayload>(token)
    }

    protected async getFreshToken(refreshToken: string, userId: string): Promise<RetterTokenData> {
        const path = `/CALL/ProjectUser/refreshToken/${this.clientConfig!.projectId}_${userId}`

        const response = await this.http!.call<RetterTokenData>(this.rootProjectId!, path, { method: 'get', params: { refreshToken } })
        return response.data
    }

    protected async getAnonymousToken(): Promise<RetterTokenData> {
        const path = `/INSTANCE/ProjectUser`
        const response = await this.http!.call<{ response: RetterTokenData }>(this.rootProjectId!, path, {
            method: 'get',
            params: { projectId: this.clientConfig!.projectId },
        })

        return response.data.response
    }

    // Remote Request
    public async signIn(token: string): Promise<RetterTokenData> {
        const userId = this.decodeToken(token).userId!
        const path = `/CALL/ProjectUser/authWithCustomToken/${this.clientConfig!.projectId}_${userId}`

        const { data: tokenData } = await this.http!.call<RetterTokenData>(this.rootProjectId!, path, { method: 'get', params: { customToken: token } })
        tokenData.accessTokenDecoded = this.decodeToken(tokenData.accessToken)
        tokenData.refreshTokenDecoded = this.decodeToken(tokenData.refreshToken)

        return tokenData
    }

    public async signOut(): Promise<void> {
        try {
            const tokenData = await this.getCurrentTokenData()
            if (tokenData) {
                const path = `/CALL/ProjectUser/signOut/${this.clientConfig!.projectId}_${tokenData.accessTokenDecoded!.userId}`

                await this.http!.call(this.rootProjectId!, path, { method: 'get' })
            }
        } catch (error) {}
    }

    // Status
    public getAuthStatus(tokenData?: RetterTokenData): RetterAuthChangedEvent {
        if (tokenData && tokenData.accessTokenDecoded) {
            const data = tokenData.accessTokenDecoded!

            return {
                uid: data.userId,
                identity: data.identity,
                authStatus: data.anonymous ? RetterAuthStatus.SIGNED_IN_ANONYM : RetterAuthStatus.SIGNED_IN,
            }
        }

        return { authStatus: RetterAuthStatus.SIGNED_OUT }
    }
}
