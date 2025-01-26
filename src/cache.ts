import { AxiosInstance, AxiosRequestConfig } from 'axios'
import { RetterCallResponse } from './types'

type CacheEntry<T> = {
  data: T
  expiry: number // Timestamp in milliseconds when the cache entry becomes stale
}

export class RioCache {
  private readonly axiosInstance: AxiosInstance
  private readonly maxEntries: number // Maximum number of cache entries
  private readonly enableLogs: boolean
  private cache: Map<string, CacheEntry<any>> = new Map()
  private pendingRequests: Map<string, Promise<any>> = new Map()

  constructor(axiosInstance: AxiosInstance, maxEntries: number = 100, enableLogs: boolean = false) {
    this.axiosInstance = axiosInstance
    this.maxEntries = maxEntries
    this.enableLogs = enableLogs
  }

  /**
   * Fetch data from a URL with caching based on Cache-Control, Age, and Date headers.
   * @param config The config to call axios.
   * @returns A Promise resolving to the fetched data.
   */
  async getWithCache<T>(config: AxiosRequestConfig): Promise<RetterCallResponse<T>> {
    const now = Date.now()
    const { url: baseUrl, params } = config

    if (!baseUrl) {
      throw new Error('Missing cacheKey')
    }

    const cacheKey = `${baseUrl}?${new URLSearchParams(params).toString()}`

    // Check if we have a valid cache entry
    if (this.cache.has(cacheKey)) {
      const cacheEntry = this.cache.get(cacheKey)!
      if (cacheEntry.expiry > now) {
        this.enableLogs && console.log('Serving from cache:', cacheKey)

        // Move the accessed entry to the end to mark it as recently used
        this.cache.delete(cacheKey)
        this.cache.set(cacheKey, cacheEntry)

        return cacheEntry.data
      } else {
        // If the entry is expired, remove it
        this.cache.delete(cacheKey)
      }
    }

    // Check if a request is already in progress for this URL
    if (this.pendingRequests.has(cacheKey)) {
      this.enableLogs && console.log(`Waiting for in-progress request: ${cacheKey}`)
      return this.pendingRequests.get(cacheKey)!
    }

    // Fetch the resource and cache it
    const fetchPromise = this.getAndCache<T>(cacheKey, config)
    this.pendingRequests.set(cacheKey, fetchPromise)

    try {
      return await fetchPromise
    } finally {
      // Clean up the pending request
      this.pendingRequests.delete(cacheKey)
    }
  }

  private async getAndCache<T>(cacheKey: string, config: AxiosRequestConfig): Promise<RetterCallResponse<T>> {
    const now = Date.now()

    const response = await this.axiosInstance!(config)
    const data: RetterCallResponse<T> = {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
      data: response.data
    }

    // Parse headers
    const cacheControl = response.headers['cache-control']
    const ageHeader = response.headers['age']
    const dateHeader = response.headers['date']

    const maxAgeMatch = cacheControl?.match(/max-age=(\d+)/)
    const maxAge = maxAgeMatch ? parseInt(maxAgeMatch[1], 10) : 0

    const age = ageHeader ? parseInt(ageHeader, 10) : 0

    // Handle time skew using the Date header
    let serverTime = now
    if (dateHeader) {
      const parsedDate = Date.parse(dateHeader)
      if (!isNaN(parsedDate)) {
        serverTime = parsedDate
      }
    }

    const freshnessLifetime = maxAge * 1000 // max-age in milliseconds
    const serverResponseAge = age * 1000 // age in milliseconds

    // Calculate remaining freshness
    const timeSinceServerResponse = now - serverTime
    const remainingFreshness = Math.max(0, freshnessLifetime - serverResponseAge - timeSinceServerResponse)

    // If remaining freshness is positive, cache the response
    if (remainingFreshness > 0) {
      // Evict the least recently used entry if cache size exceeds the limit
      if (this.cache.size >= this.maxEntries) {
        const firstKey = Array.from(this.cache.keys())[0] // Get the first key explicitly
        this.cache.delete(firstKey)
        this.enableLogs && console.log(`Evicted cache entry: ${firstKey}`)
      }

      this.cache.set(cacheKey, {
        data,
        expiry: now + remainingFreshness, // Remaining freshness is already in milliseconds
      })

      this.enableLogs && console.log(`Caching response with remaining freshness: ${remainingFreshness / 1000}s`)
    } else {
      this.enableLogs && console.log('No remaining freshness not caching.')
    }

    return data
  }
}
