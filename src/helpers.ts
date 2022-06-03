import { Runtime } from './types'

export function getRuntime(): Runtime {
    if (typeof document != 'undefined') return Runtime.web

    return Runtime.node
}

export function base64Encode(str: string): string {
    return Buffer.from(str).toString('base64')
}
