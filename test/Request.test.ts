import { describe, it, mock } from 'node:test'
import assert from 'node:assert'
import Retter from '../src'
import axios from 'axios'

describe('request tests', () => {
  it('should use cache', async (context) => {

    context.mock.timers.enable({ apis: ['Date'] })

    const mockedResponse = {
      status: 200,
      statusText: 'OK',
      headers: {},
      data: {},
    }
    mock.method(axios, 'create', () => {
      return async () => mockedResponse;
    })

    const retter = Retter.getInstance({
      projectId: 'projectId',
      url: 'test',
      culture: 'tr-TR',
      platform: 'web',
      memoryCache: {
        enabled: true,
        enableLogs: true,
      }
    })
    const cloudObject = await retter.getCloudObject({
      classId: 'test',
      useLocal: true,
      instanceId: 'test',
    })

    mockedResponse.data = { count: 1 }
    assert.deepEqual((await cloudObject.call({method: 'test', httpMethod: 'get'})).data, { count: 1 })

    mockedResponse.data = { count: 2 }
    assert.deepEqual((await cloudObject.call({method: 'test', httpMethod: 'get'})).data, { count: 2 })

    mockedResponse.headers = { 'cache-control': 'max-age=30' }
    mockedResponse.data = { count: 3 }
    assert.deepEqual((await cloudObject.call({method: 'test', httpMethod: 'get'})).data, { count: 3 })

    mockedResponse.headers = { 'cache-control': 'max-age=30' }
    mockedResponse.data = { count: 4 }
    context.mock.timers.tick(10000)
    assert.deepEqual((await cloudObject.call({method: 'test', httpMethod: 'get'})).data, { count: 3 })

    context.mock.timers.tick(20000)
    mockedResponse.headers = { 'cache-control': 'max-age=30' }
    mockedResponse.data = { count: 5 }
    assert.deepEqual((await cloudObject.call({method: 'test', httpMethod: 'get'})).data, { count: 5 })
  })
})
