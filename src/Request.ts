import axios, { AxiosInstance } from 'axios'

import { base64Encode, sort } from './helpers'
import { RetterCallResponse, RetterClientConfig, RetterRegion, RetterRegionConfig } from './types'
import { RioCache } from './cache'

const RetterRegions: RetterRegionConfig[] = [
    {
        id: RetterRegion.euWest1,
        url: 'api.retter.io',
    },
    {
        id: RetterRegion.euWest1Beta,
        url: 'test-api.retter.io',
    },
]

export default class Request {
    private url?: string

    private region?: RetterRegionConfig

    private culture?: string

    private platform?: string

    private rioFetch?: RioCache

    private axiosInstance?: AxiosInstance

    constructor(config: RetterClientConfig) {
        this.createAxiosInstance()

        this.url = config.url
        if (!config.region) config.region = RetterRegion.euWest1
        this.region = RetterRegions.find(region => region.id === config.region)

        this.culture = config.culture
        this.platform = config.platform
        if (config.memoryCache?.enabled) {
            this.rioFetch = new RioCache(this.axiosInstance!, config.memoryCache.maxEntryCount, config.memoryCache.enableLogs)
        }
    }

    protected createAxiosInstance() {
        this.axiosInstance! = axios.create({
            responseType: 'json',
            headers: {
                'Content-Type': 'application/json',
            },
            timeout: 30000,
        })
    }

    protected buildUrl(projectId: string, path: string) {
        const prefix = this.url ? `${this.url}` : `${projectId}.${this.region!.url}`
        return `https://${prefix}/${projectId}/${path.startsWith('/') ? path.substring(1) : path}`
    }

    public async call<T>(projectId: string, path: string, params?: any): Promise<RetterCallResponse<T>> {
        try {
            const queryStringParams = { ...params.params }
            if (!queryStringParams.__culture && this.culture) queryStringParams.__culture = this.culture
            if (!queryStringParams.__platform && this.platform) queryStringParams.__platform = this.platform

            if (params.method === 'get' && params.base64Encode !== false && params.data) {
                const data = base64Encode(JSON.stringify(sort(params.data)))
                delete params.data
                queryStringParams.data = data
                queryStringParams.__isbase64 = true
            }

            const config = { url: this.buildUrl(projectId, path), ...params, params: queryStringParams }

            if (this.rioFetch && params.method === 'get') {
                return this.rioFetch.getWithCache(config)
            }
            return this.axiosInstance!(config)
        } catch (error: any) {
            throw error
        }
    }
}
