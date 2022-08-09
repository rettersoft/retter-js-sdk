import { Runtime } from './types'

export function getRuntime(): Runtime {
    if (typeof document != 'undefined') return Runtime.web

    return Runtime.node
}

export function base64Encode(str: string): string {
    return Buffer.from(str).toString('base64')
}

export function sort(data: any): any {
    if (data == null) {
        return data
    } else if (Array.isArray(data)) {
        return data.sort().map(sort)
    } else if (typeof data === 'object') {
        return Object.keys(data)
            .sort()
            .reduce((acc, key) => {
                acc[key] = sort(data[key])
                return acc
            }, {} as Record<string, any>)
    }

    return data
}
