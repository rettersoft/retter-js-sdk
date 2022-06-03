import axios, { AxiosInstance, AxiosResponse } from 'axios'

import { base64Encode } from './helpers'
import { RetterClientConfig, RetterRegion, RetterRegionConfig } from './types'

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

    private axiosInstance?: AxiosInstance

    constructor(config: RetterClientConfig) {
        this.createAxiosInstance()

        this.url = config.url
        if (!config.region) config.region = RetterRegion.euWest1
        this.region = RetterRegions.find(region => region.id === config.region)

        this.culture = config.culture
        this.platform = config.culture
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
        return `https://${prefix}/${projectId}/${path.startsWith('/') ? path.substr(1) : path}`
    }

    public async call<T>(projectId: string, path: string, params?: any): Promise<AxiosResponse<T>> {
        try {
            const queryStringParams = { ...params.params }
            if (!queryStringParams.__culture && this.culture) queryStringParams.__culture = this.culture
            if (!queryStringParams.__platform && this.platform) queryStringParams.__platform = this.platform

            if (params.method === 'get' && params.base64Encode !== false && params.data) {
                const data = base64Encode(JSON.stringify(params.data))
                delete params.data
                queryStringParams.data = data
                queryStringParams.__isbase64 = true
            }

            return await this.axiosInstance!({ url: this.buildUrl(projectId, path), ...params, params: queryStringParams })
        } catch (error: any) {
            throw error
        }
    }
}
