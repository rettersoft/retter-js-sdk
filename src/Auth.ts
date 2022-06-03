import jwt from 'jwt-decode'
import AsyncStorage from '@react-native-async-storage/async-storage'

import { getRuntime } from './helpers'
import RetterRequest from './Request'
import { RetterAuthChangedEvent, RetterAuthStatus, RetterClientConfig, RetterTokenData, RetterTokenPayload } from './types'

export default class Auth {
    /**
     * Request class instance.
     */
    private http?: RetterRequest

    private clientConfig?: RetterClientConfig

    private rootProjectId?: string

    private tokenStorageKey?: string

    /**
     * It is used when sdk not used with browser or react native.
     */
    private currentTokenData?: RetterTokenData

    constructor(config: RetterClientConfig) {
        this.clientConfig = config
        this.tokenStorageKey = `RIO_TOKENS_KEY.${config.projectId}`

        this.rootProjectId = config.rootProjectId ?? 'root'
    }

    public setHttp(http: RetterRequest) {
        this.http = http
    }

    /**
     * Stores the token data in the platforms storage.
     * For web, it uses localStorage.
     * For react-native, it uses AsyncStorage.
     * For node or other platforms, it uses the currentTokenData property.
     *
     * @param tokenData
     * @returns void
     */
    public async storeTokenData(tokenData: RetterTokenData | string) {
        const runtime = getRuntime()
        if (typeof tokenData === 'undefined') return
        if (runtime === 'web') {
            localStorage.setItem(this.tokenStorageKey!, JSON.stringify(tokenData))
        }
        if (runtime === 'react-native') {
            await AsyncStorage.setItem(this.tokenStorageKey!, JSON.stringify(tokenData))
        }
        this.currentTokenData = tokenData as RetterTokenData
    }

    /**
     * Clears the token data from the platforms storage.
     *
     * @returns void
     */
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

    /**
     * Retrieves the token data from the platforms storage.
     *
     * @returns RetterTokenData | undefined
     */
    public async getCurrentTokenData(): Promise<RetterTokenData | undefined> {
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

        if (data && (!data.accessTokenDecoded || !data.refreshTokenDecoded)) {
            data.accessTokenDecoded = this.decodeToken(data.accessToken)
            data.refreshTokenDecoded = this.decodeToken(data.refreshToken)
        }

        return data
    }

    /**
     * Current user means the decoded data from the access token.
     * So, it returns the decoded access token.
     *
     * @returns RetterTokenPayload | undefined
     */
    public async getCurrentUser(): Promise<RetterTokenPayload | undefined> {
        const tokenData = await this.getCurrentTokenData()
        return tokenData?.accessTokenDecoded
    }

    /**
     * It checks if the token is expired or stored in the platforms storage.
     * If it is expired, it tries to refresh the token.
     * If it is not expired, it returns the token data.
     * If it is not stored in the platforms storage, it tries to get it from the server anonymously.
     *
     * @returns RetterTokenData | undefined
     */
    public async getTokenData(): Promise<RetterTokenData | undefined> {
        const tokenData = await this.getCurrentTokenData()
        if (tokenData) {
            const now = tokenData.diff + Math.round(new Date().getTime() / 1000) + 30 // Plus 30 seconds, just in case.

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
        }

        return await this.getAnonymousToken()
    }

    /**
     * It decodes the jwt token.
     *
     * @param token
     * @returns RetterTokenPayload
     */
    protected decodeToken(token: string): RetterTokenPayload {
        return jwt<RetterTokenPayload>(token)
    }

    /**
     * It adds decoded access and refresh tokens to the token data.
     * Also it adds the diff between the current time and the server time.
     *
     * @param tokenData RetterTokenData
     * @returns RetterTokenData
     */
    protected formatTokenData(tokenData: RetterTokenData): RetterTokenData {
        tokenData.accessTokenDecoded = this.decodeToken(tokenData.accessToken)
        tokenData.refreshTokenDecoded = this.decodeToken(tokenData.refreshToken)
        if (tokenData.accessTokenDecoded.iat) {
            tokenData.diff = tokenData.accessTokenDecoded.iat - Math.floor(Date.now() / 1000)
        }

        return tokenData
    }

    /**
     * It tries to get a new access token from the server.
     *
     * @param refreshToken
     * @param userId string // used in the url
     * @returns RetterTokenData
     */
    protected async getFreshToken(refreshToken: string, userId: string): Promise<RetterTokenData> {
        const path = `/CALL/ProjectUser/refreshToken/${this.clientConfig!.projectId}_${userId}`

        const response = await this.http!.call<RetterTokenData>(this.rootProjectId!, path, { method: 'get', params: { refreshToken } })
        return this.formatTokenData(response.data)
    }

    /**
     * It tries to get a access token from the server anonymously.
     *
     * @returns RetterTokenData
     */
    protected async getAnonymousToken(): Promise<RetterTokenData> {
        const path = `/INSTANCE/ProjectUser`
        const response = await this.http!.call<{ response: RetterTokenData }>(this.rootProjectId!, path, {
            method: 'get',
            params: { projectId: this.clientConfig!.projectId },
        })

        return this.formatTokenData(response.data.response)
    }

    /**
     * It tries to get a access token from the server.
     * It uses the customToken to get the access token.
     *
     * @param token string // customToken
     * @returns RetterTokenData
     */
    public async signIn(token: string): Promise<RetterTokenData> {
        const userId = this.decodeToken(token).userId!
        const path = `/CALL/ProjectUser/authWithCustomToken/${this.clientConfig!.projectId}_${userId}`

        const { data: tokenData } = await this.http!.call<RetterTokenData>(this.rootProjectId!, path, { method: 'get', params: { customToken: token } })

        return this.formatTokenData(tokenData)
    }

    /**
     * It tries to notify the server that the user is logged out.
     *
     * @returns void
     */
    public async signOut(): Promise<void> {
        try {
            const tokenData = await this.getCurrentTokenData()
            
            if (tokenData) {
                const path = `/CALL/ProjectUser/signOut/${this.clientConfig!.projectId}_${tokenData.accessTokenDecoded!.userId}`
                
                await this.http!.call(this.rootProjectId!, path, { method: 'get', params: { accessToken: tokenData.accessToken } })
            }
        } catch (error) {}
    }

    /**
     * It determines the user's status from the token data.
     *
     * @param tokenData RetterTokenData
     * @returns RetterAuthChangedEvent
     */
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
