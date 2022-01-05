var Buffer = require('buffer/').Buffer

export interface ActionEvent {
    action: string
    actionType: string
    projectId: string
    identity: string
    userId: string
    serviceId: string
    actionPayload: any
    processExecutionId: string
    processId: string
    processExecutorId: string
    processExecutorRole: string
    claims: any
    isAnonymous: boolean
    culture: string
    platform: string
}

export const headers: any = {
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Method': '*',
    'Access-Control-Allow-Credentials': true,
}

export enum RESPONSE_TYPE {
    SUCCESS,
    NO_CONTENT,
    METHOD_NOT_ALLOWED,
    BAD_REQUEST,
    AUTH_FAILED,
    PERMISSION_DENIED,
    NOT_FOUND,
    INTERNAL_SERVER_ERROR,
}

const getStatus = (responseType: RESPONSE_TYPE): number => {
    switch (responseType) {
        case RESPONSE_TYPE.SUCCESS:
            return 200
        case RESPONSE_TYPE.NO_CONTENT:
            return 204
        case RESPONSE_TYPE.BAD_REQUEST:
            return 400
        case RESPONSE_TYPE.AUTH_FAILED:
            return 401
        case RESPONSE_TYPE.PERMISSION_DENIED:
            return 403
        case RESPONSE_TYPE.NOT_FOUND:
            return 404
        case RESPONSE_TYPE.METHOD_NOT_ALLOWED:
            return 405
        case RESPONSE_TYPE.INTERNAL_SERVER_ERROR:
            return 500
    }
}

export interface RbsServiceResponse {
    responseType: RESPONSE_TYPE
    errorCode?: string
    message?: any
    culture?: string
    data?: any
    transform?: boolean
    transformContext?: { [key: string]: string }
    errors?: string[]
    cacheForDuration?: Duration
    headers?: { [key: string]: string }
}

export class Duration {
    private _seconds: number = 0
    static seconds = (amount: number): Duration => {
        let d = new Duration()
        d._seconds = amount
        return d
    }
    static minutes = (amount: number): Duration => {
        let d = new Duration()
        d._seconds = amount * 60
        return d
    }
    static hours = (amount: number): Duration => {
        let d = new Duration()
        d._seconds = amount * 3600
        return d
    }
    static days = (amount: number): Duration => {
        let d = new Duration()
        d._seconds = amount * 3600 * 24
        return d
    }
    getSeconds = (): number => {
        return this._seconds
    }
}

export const createResponse = (response: RbsServiceResponse): any => {
    //message: response.message ? response.message : JSON.stringify(response.responseType),

    if (!response.transform) response.transform = false
    //if(!response.transformContext) response.transform = false
    if (!response.culture) response.culture = 'en-US'

    let reqHeaders = {
        ...headers,
        ['x-rbs-errorcode']: response.errorCode,
        ['Cache-Control']: response.cacheForDuration ? `max-age=${response.cacheForDuration.getSeconds()}` : 'max-age=0',
        ...response.headers,
    }

    if (response.transform) {
        reqHeaders['x-rbs-transform'] = response.transform
        if (response.transformContext) reqHeaders['x-rbs-transform-context'] = Buffer.from(JSON.stringify(response.transformContext)).toString('base64')
    }

    reqHeaders['x-rbs-culture'] = response.culture

    return {
        statusCode: getStatus(response.responseType),
        headers: reqHeaders,
        body: JSON.stringify({
            errors: response.errors,
            data: response.data,
        }),
    }
}

export interface ValidationError {
    target?: Object // Object that was validated.
    property?: string // Object's property that haven't pass validation.
    value?: any // Value that haven't pass a validation.
    constraints?: {
        // Constraints that failed validation with error messages.
        [type: string]: string
    }
    children?: ValidationError[] // Contains all nested validation errors of the property
}

export const parseClassValidatorErrors = (errors: ValidationError[]): string[] => {
    let root: ValidationError = {
        target: {},
        property: '',
        value: '',
        children: errors,
    }

    return parseClassValidatorErrorObject('root', root)
}

const parseClassValidatorErrorObject = (path: string, validationError: ValidationError): string[] => {
    let errStrings: string[] = []

    if (validationError.constraints) {
        let keys = Object.keys(validationError.constraints)
        for (let k of keys) {
            errStrings.push(path + '.' + String(validationError.constraints[k]))
        }
    }
    path = path + (validationError.property ? '.' + validationError.property : '')
    if (validationError.children && validationError.children.length > 0) {
        for (let c of validationError.children) {
            errStrings = [...errStrings, ...parseClassValidatorErrorObject(path, c)]
        }
    }
    return errStrings
}
