import axios, { AxiosInstance, AxiosRequestConfig } from 'axios'

import { RetterClientConfig, RetterRegion, RetterRegionConfig } from './types'

const RetterRegions: RetterRegionConfig[] = [
    {
        id: RetterRegion.euWest1,
        url: 'api.rtbs.io',
    },
    {
        id: RetterRegion.euWest1Beta,
        url: 'test-api.rtbs.io',
    },
]

export default class Request {
    private region?: RetterRegionConfig

    private axiosInstance?: AxiosInstance

    constructor(config: RetterClientConfig) {
        this.createAxiosInstance()
        this.region = RetterRegions.find(region => region.id === config.region)
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
        const url = `https://${projectId}.${this.region!.url}/${path}`

        return url
    }

    public async call<T>(projectId: string, path: string, params?: any): Promise<T> {
        try {
            const response = await this.axiosInstance!({ url: this.buildUrl(projectId, path), ...params })
            return response.data
        } catch (error: any) {
            console.log(error.response ?? error)
            throw error
        }
    }
}
