export function getRuntime(): 'web' | 'react-native' | 'node' {
    if (typeof document != 'undefined') return 'web'
    if (typeof navigator != 'undefined' && navigator.product == 'ReactNative') return 'react-native'
    return 'node'
}

export function base64Encode(str: string): string {
    return Buffer.from(str).toString('base64')
}
