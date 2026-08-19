import { describe, it, beforeEach, mock } from 'node:test'
import assert from 'node:assert'
import Auth from '../src/Auth'
import { RetterAuthStatus, RetterClientConfig, RetterTokenData } from '../src/types'

// Helper to create a fake JWT payload that jwt-decode will "return"
function fakeToken(payload: Record<string, any>): string {
  // jwt-decode splits on '.', base64-decodes the second part
  const header = Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url')
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const sig = 'fakesig'
  return `${header}.${body}.${sig}`
}

function createTokenData(overrides: Partial<RetterTokenData> = {}): RetterTokenData {
  const now = Math.floor(Date.now() / 1000)
  const accessPayload = { userId: 'user1', identity: 'id1', projectId: 'p1', iat: now, exp: now + 3600 }
  const refreshPayload = { userId: 'user1', identity: 'id1', projectId: 'p1', iat: now, exp: now + 86400 }

  return {
    accessToken: fakeToken(accessPayload),
    refreshToken: fakeToken(refreshPayload),
    accessTokenExpiresAt: now + 3600,
    refreshTokenExpiresAt: now + 86400,
    firebase: { apiKey: 'key', projectId: 'fbproj', customToken: 'fbtoken' },
    diff: 0,
    ...overrides,
  }
}

function createConfig(overrides: Partial<RetterClientConfig> = {}): RetterClientConfig {
  return { projectId: 'test-project', ...overrides }
}

describe('Auth', () => {
  describe('storeTokenData and getCurrentTokenData', () => {
    it('should store and retrieve token data in node runtime (memory)', async () => {
      const auth = new Auth(createConfig())
      const tokenData = createTokenData()

      await auth.storeTokenData(tokenData)
      const retrieved = await auth.getCurrentTokenData()

      assert.ok(retrieved)
      assert.equal(retrieved!.accessToken, tokenData.accessToken)
      assert.equal(retrieved!.refreshToken, tokenData.refreshToken)
    })

    it('should decode tokens when accessTokenDecoded is missing', async () => {
      const auth = new Auth(createConfig())
      const tokenData = createTokenData()
      delete (tokenData as any).accessTokenDecoded
      delete (tokenData as any).refreshTokenDecoded

      await auth.storeTokenData(tokenData)
      const retrieved = await auth.getCurrentTokenData()

      assert.ok(retrieved!.accessTokenDecoded)
      assert.ok(retrieved!.refreshTokenDecoded)
      assert.equal(retrieved!.accessTokenDecoded!.userId, 'user1')
    })

    it('should return undefined when no token is stored', async () => {
      const auth = new Auth(createConfig())
      const result = await auth.getCurrentTokenData()
      assert.equal(result, undefined)
    })
  })

  describe('clearTokenData', () => {
    it('should clear stored token data', async () => {
      const auth = new Auth(createConfig())
      await auth.storeTokenData(createTokenData())

      await auth.clearTokenData()
      const result = await auth.getCurrentTokenData()
      assert.equal(result, undefined)
    })
  })

  describe('getCurrentUser', () => {
    it('should return decoded access token payload', async () => {
      const auth = new Auth(createConfig())
      await auth.storeTokenData(createTokenData())

      const user = await auth.getCurrentUser()
      assert.ok(user)
      assert.equal(user!.userId, 'user1')
      assert.equal(user!.identity, 'id1')
    })

    it('should return undefined when no token stored', async () => {
      const auth = new Auth(createConfig())
      const user = await auth.getCurrentUser()
      assert.equal(user, undefined)
    })
  })

  describe('getTokenData', () => {
    it('should return undefined when no token stored', async () => {
      const auth = new Auth(createConfig())
      const result = await auth.getTokenData()
      assert.equal(result, undefined)
    })

    it('should return token data when access token is not expired', async () => {
      const auth = new Auth(createConfig())
      const tokenData = createTokenData()
      await auth.storeTokenData(tokenData)

      const result = await auth.getTokenData()
      assert.ok(result)
      assert.equal(result!.accessToken, tokenData.accessToken)
    })

    it('should refresh when access token is expired but refresh token is valid', async () => {
      const now = Math.floor(Date.now() / 1000)

      // Access token expired 60s ago, refresh token valid for 24h
      const accessPayload = { userId: 'user1', identity: 'id1', iat: now - 3700, exp: now - 60 }
      const refreshPayload = { userId: 'user1', identity: 'id1', iat: now, exp: now + 86400 }

      const freshAccessPayload = { userId: 'user1', identity: 'id1', iat: now, exp: now + 3600 }
      const freshRefreshPayload = { userId: 'user1', identity: 'id1', iat: now, exp: now + 86400 }

      const expiredTokenData = createTokenData({
        accessToken: fakeToken(accessPayload),
        refreshToken: fakeToken(refreshPayload),
        diff: 0,
      })

      const freshTokenData: RetterTokenData = {
        accessToken: fakeToken(freshAccessPayload),
        refreshToken: fakeToken(freshRefreshPayload),
        accessTokenExpiresAt: now + 3600,
        refreshTokenExpiresAt: now + 86400,
        firebase: { apiKey: 'key', projectId: 'fbproj', customToken: 'fbtoken' },
        diff: 0,
      }

      const mockHttp = {
        call: mock.fn(async (...args: any[]) => ({ data: freshTokenData })),
      }

      const auth = new Auth(createConfig())
      auth.setHttp(mockHttp as any)
      await auth.storeTokenData(expiredTokenData)

      const result = await auth.getTokenData()

      assert.ok(result)
      assert.equal(result!.accessToken, freshTokenData.accessToken)
      assert.equal(mockHttp.call.mock.callCount(), 1)
    })
  })

  describe('signIn', () => {
    it('should call /TOKEN/auth and return formatted token data', async () => {
      const now = Math.floor(Date.now() / 1000)
      const responseTokenData: RetterTokenData = {
        accessToken: fakeToken({ userId: 'u1', identity: 'id1', iat: now, exp: now + 3600 }),
        refreshToken: fakeToken({ userId: 'u1', identity: 'id1', iat: now, exp: now + 86400 }),
        accessTokenExpiresAt: now + 3600,
        refreshTokenExpiresAt: now + 86400,
        firebase: { apiKey: 'key', projectId: 'fbproj', customToken: 'ct' },
        diff: 0,
      }

      const mockHttp = {
        call: mock.fn(async (...args: any[]) => ({ data: responseTokenData })),
      }

      const auth = new Auth(createConfig())
      auth.setHttp(mockHttp as any)

      const result = await auth.signIn('custom-token-123')

      assert.ok(result)
      assert.ok(result.accessTokenDecoded)
      assert.ok(result.refreshTokenDecoded)
      assert.equal(result.accessTokenDecoded!.userId, 'u1')

      // Verify the call was made to /TOKEN/auth
      const callArgs = mockHttp.call.mock.calls[0].arguments
      assert.equal(callArgs[0], 'test-project')
      assert.equal(callArgs[1], '/TOKEN/auth')
      assert.deepEqual(callArgs[2].data, { customToken: 'custom-token-123' })
    })
  })

  describe('signOut', () => {
    it('should call /TOKEN/signOut with bearer token', async () => {
      const mockHttp = {
        call: mock.fn(async (...args: any[]) => ({})),
      }

      const auth = new Auth(createConfig())
      auth.setHttp(mockHttp as any)
      await auth.storeTokenData(createTokenData())

      await auth.signOut()

      assert.equal(mockHttp.call.mock.callCount(), 1)
      const callArgs = mockHttp.call.mock.calls[0].arguments
      assert.equal(callArgs[1], '/TOKEN/signOut')
      assert.ok(callArgs[2].headers.Authorization.startsWith('Bearer '))
    })

    it('should not call server when no token stored', async () => {
      const mockHttp = {
        call: mock.fn(async (...args: any[]) => ({})),
      }

      const auth = new Auth(createConfig())
      auth.setHttp(mockHttp as any)

      await auth.signOut()
      assert.equal(mockHttp.call.mock.callCount(), 0)
    })

    it('should silently swallow errors', async () => {
      const mockHttp = {
        call: mock.fn(async (...args: any[]) => { throw new Error('network error') }),
      }

      const auth = new Auth(createConfig())
      auth.setHttp(mockHttp as any)
      await auth.storeTokenData(createTokenData())

      // Should not throw
      await auth.signOut()
    })
  })

  describe('getAuthStatus', () => {
    it('should return SIGNED_IN with uid and identity when token present', () => {
      const auth = new Auth(createConfig())
      const tokenData = createTokenData()
      tokenData.accessTokenDecoded = { userId: 'user1', identity: 'id1' }

      const status = auth.getAuthStatus(tokenData)
      assert.equal(status.authStatus, RetterAuthStatus.SIGNED_IN)
      assert.equal(status.uid, 'user1')
      assert.equal(status.identity, 'id1')
    })

    it('should return SIGNED_OUT when no token data', () => {
      const auth = new Auth(createConfig())
      const status = auth.getAuthStatus(undefined)
      assert.equal(status.authStatus, RetterAuthStatus.SIGNED_OUT)
    })

    it('should return SIGNED_OUT when token data has no decoded token', () => {
      const auth = new Auth(createConfig())
      const tokenData = createTokenData()
      delete (tokenData as any).accessTokenDecoded

      const status = auth.getAuthStatus(tokenData)
      assert.equal(status.authStatus, RetterAuthStatus.SIGNED_OUT)
    })
  })

  describe('token storage key', () => {
    it('should use project-specific storage key', async () => {
      const auth1 = new Auth(createConfig({ projectId: 'project-a' }))
      const auth2 = new Auth(createConfig({ projectId: 'project-b' }))

      const tokenA = createTokenData()
      const tokenB = createTokenData({
        accessToken: fakeToken({ userId: 'userB', identity: 'idB', iat: 1000, exp: 9999999999 }),
      })

      await auth1.storeTokenData(tokenA)
      await auth2.storeTokenData(tokenB)

      const retrievedA = await auth1.getCurrentTokenData()
      const retrievedB = await auth2.getCurrentTokenData()

      assert.equal(retrievedA!.accessToken, tokenA.accessToken)
      assert.equal(retrievedB!.accessToken, tokenB.accessToken)
    })
  })
})
