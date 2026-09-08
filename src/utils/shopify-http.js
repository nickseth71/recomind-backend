// import axios from "axios"
// import Store from "../models/store.model.js"
// import logger from "../config/logger.js"

// /**
//  * Every call in shopify.service.js goes through this instance instead of
//  * the bare `axios` import. That's what lets a single interceptor here
//  * cover every existing call site (REST and GraphQL both use the same
//  * X-Shopify-Access-Token header) with zero changes needed at each call
//  * site itself.
//  */
// const shopifyHttp = axios.create()

// function extractShopFromUrl(url) {
//   try {
//     return new URL(url).hostname
//   } catch {
//     return null
//   }
// }

// /**
//  * Exchange a refresh token for a new access token, and persist both
//  * (access token + rotated refresh token, per Shopify's one-time-use
//  * refresh token model) back to the store atomically.
//  */
// async function refreshAccessToken(store) {
//   const refreshToken = store.getRefreshToken()
//   if (!refreshToken) {
//     throw new Error(`No refresh token stored for ${store.shopDomain}`)
//   }

//   const shopifyApiKey = process.env.SHOPIFY_API_KEY
//   const shopifyApiSecret = process.env.SHOPIFY_API_SECRET
//   if (!shopifyApiKey || !shopifyApiSecret) {
//     throw new Error(
//       "Missing Shopify API credentials: SHOPIFY_API_KEY and SHOPIFY_API_SECRET must be set",
//     )
//   }

//   const response = await axios.post(
//     `https://${store.shopDomain}/admin/oauth/access_token`,
//     new URLSearchParams({
//       client_id: shopifyApiKey,
//       client_secret: shopifyApiSecret,
//       grant_type: "refresh_token",
//       refresh_token: refreshToken,
//     }),
//     { headers: { "Content-Type": "application/x-www-form-urlencoded" } },
//   )

//   const data = response.data
//   const accessTokenExpiresAt = data.expires_in
//     ? new Date(Date.now() + data.expires_in * 1000)
//     : null
//   // Shopify invalidates the previous refresh token after use and issues a
//   // new one with a fresh 90-day window — always store whatever comes back.
//   const refreshTokenExpiresAt = data.refresh_token_expires_in
//     ? new Date(Date.now() + data.refresh_token_expires_in * 1000)
//     : store.refreshTokenExpiresAt

//   store.setAccessToken(data.access_token)
//   if (data.refresh_token) store.setRefreshToken(data.refresh_token)
//   store.accessTokenExpiresAt = accessTokenExpiresAt
//   store.refreshTokenExpiresAt = refreshTokenExpiresAt
//   await store.save()

//   logger.info(`↻ Refreshed Shopify access token for ${store.shopDomain}`)
//   return data.access_token
// }

// // Coalesce concurrent refresh attempts for the same store into one request.
// // If several API calls fail at once because the token just expired, we do
// // NOT want to fire several parallel refresh calls — Shopify invalidates
// // the previous refresh token as soon as it's used once, so a second
// // concurrent refresh attempt with that same (now-stale) refresh token
// // would itself fail.
// const refreshInFlight = new Map()

// function refreshOnce(store) {
//   const key = store.shopDomain
//   if (refreshInFlight.has(key)) return refreshInFlight.get(key)
//   const promise = refreshAccessToken(store).finally(() =>
//     refreshInFlight.delete(key),
//   )
//   refreshInFlight.set(key, promise)
//   return promise
// }

// shopifyHttp.interceptors.response.use(
//   (response) => response,
//   async (error) => {
//     const status = error.response?.status
//     const config = error.config

//     // Only handle genuine auth failures, and only ever retry a given
//     // request once — if the retried request ALSO 401s, something deeper
//     // is wrong (revoked app, invalid refresh token) and we should surface
//     // the real error rather than loop.
//     if (status !== 401 || !config || config._retriedAfterRefresh) {
//       return Promise.reject(error)
//     }

//     const shopDomain = extractShopFromUrl(config.url)
//     if (!shopDomain) return Promise.reject(error)

//     try {
//       const store = await Store.findOne({ shopDomain })
//       if (!store || !store.getRefreshToken()) {
//         // No refresh token on file — nothing we can do automatically.
//         // Store predates this feature, or the merchant needs to reinstall.
//         return Promise.reject(error)
//       }

//       const newAccessToken = await refreshOnce(store)

//       config._retriedAfterRefresh = true
//       if (config.headers?.["X-Shopify-Access-Token"]) {
//         config.headers["X-Shopify-Access-Token"] = newAccessToken
//       }
//       return shopifyHttp(config)
//     } catch (refreshErr) {
//       logger.error(
//         `Token refresh failed for ${shopDomain}: ${refreshErr.message}`,
//         refreshErr.response?.data || refreshErr.stack,
//       )
//       return Promise.reject(error)
//     }
//   },
// )

// export default shopifyHttp
// export { refreshAccessToken }

import axios from "axios"
import Store from "../models/store.model.js"
import logger from "../config/logger.js"
import { getRedis } from "../config/redis.js"

/**
 * Every call in shopify.service.js goes through this instance instead of
 * the bare `axios` import. That's what lets a single interceptor here
 * cover every existing call site (REST and GraphQL both use the same
 * X-Shopify-Access-Token header) with zero changes needed at each call
 * site itself.
 */
const shopifyHttp = axios.create()

function extractShopFromUrl(url) {
  try {
    return new URL(url).hostname
  } catch {
    return null
  }
}

/**
 * Exchange a refresh token for a new access token, and persist both
 * (access token + rotated refresh token, per Shopify's one-time-use
 * refresh token model) back to the store atomically.
 */
async function performRefresh(store) {
  const refreshToken = store.getRefreshToken()
  if (!refreshToken) {
    throw new Error(`No refresh token stored for ${store.shopDomain}`)
  }

  const shopifyApiKey = process.env.SHOPIFY_API_KEY
  const shopifyApiSecret = process.env.SHOPIFY_API_SECRET
  if (!shopifyApiKey || !shopifyApiSecret) {
    throw new Error(
      "Missing Shopify API credentials: SHOPIFY_API_KEY and SHOPIFY_API_SECRET must be set",
    )
  }

  const response = await axios.post(
    `https://${store.shopDomain}/admin/oauth/access_token`,
    new URLSearchParams({
      client_id: shopifyApiKey,
      client_secret: shopifyApiSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
    { headers: { "Content-Type": "application/x-www-form-urlencoded" } },
  )

  const data = response.data
  const accessTokenExpiresAt = data.expires_in
    ? new Date(Date.now() + data.expires_in * 1000)
    : null
  // Shopify invalidates the previous refresh token after use and issues a
  // new one with a fresh 90-day window — always store whatever comes back.
  const refreshTokenExpiresAt = data.refresh_token_expires_in
    ? new Date(Date.now() + data.refresh_token_expires_in * 1000)
    : store.refreshTokenExpiresAt

  store.setAccessToken(data.access_token)
  if (data.refresh_token) store.setRefreshToken(data.refresh_token)
  store.accessTokenExpiresAt = accessTokenExpiresAt
  store.refreshTokenExpiresAt = refreshTokenExpiresAt
  await store.save()

  logger.info(`↻ Refreshed Shopify access token for ${store.shopDomain}`)
  return data.access_token
}

const LOCK_TTL_MS = 20_000
const LOCK_POLL_INTERVAL_MS = 250
const LOCK_WAIT_TIMEOUT_MS = 15_000

/**
 * Cross-process coordination for token refresh, via a Redis lock.
 *
 * The API server and the BullMQ worker are SEPARATE Node processes — an
 * in-memory Map (the old approach) only coordinates concurrent refreshes
 * within a single process, and has no idea what the other process is
 * doing. Since both processes already share one Redis instance, that's
 * the right place to coordinate: whichever process gets the lock actually
 * calls Shopify; everyone else waits for the lock to clear, then reads
 * the (now-fresh) token straight from the DB instead of attempting a
 * second refresh with a refresh token Shopify has likely already
 * invalidated.
 */
async function refreshOnce(store) {
  const redis = getRedis()
  const lockKey = `shopify:token-refresh:${store.shopDomain}`
  const lockValue = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`

  const acquired = await redis.set(lockKey, lockValue, "NX", "PX", LOCK_TTL_MS)

  if (acquired) {
    try {
      // Re-check the DB first — another process could have refreshed and
      // released the lock in the brief window between this request's 401
      // and us acquiring the lock.
      const fresh = await Store.findById(store._id)
      if (fresh?.accessToken && isStillFresh(fresh)) {
        return fresh.accessToken
      }
      return await performRefresh(store)
    } finally {
      // Only clear the lock if it's still ours (avoid deleting a lock
      // some other process acquired after ours expired).
      const script = `
        if redis.call("get", KEYS[1]) == ARGV[1] then
          return redis.call("del", KEYS[1])
        else
          return 0
        end
      `
      await redis.eval(script, 1, lockKey, lockValue).catch(() => {})
    }
  }

  // Someone else holds the lock — wait for them to finish, then use
  // whatever token they end up with instead of racing our own refresh.
  const deadline = Date.now() + LOCK_WAIT_TIMEOUT_MS
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, LOCK_POLL_INTERVAL_MS))
    const stillLocked = await redis.get(lockKey)
    const fresh = await Store.findById(store._id)
    if (!stillLocked && fresh?.accessToken && isStillFresh(fresh)) {
      return fresh.accessToken
    }
    if (!stillLocked && fresh?.accessToken) {
      // Lock cleared but token doesn't look freshly rotated — the other
      // process's refresh may have failed. Fall through and try our own.
      break
    }
  }

  throw new Error(
    `Timed out waiting for concurrent token refresh for ${store.shopDomain}`,
  )
}

function isStillFresh(store) {
  // A 401 already proved the token is unusable. If expiry metadata is absent,
  // force a refresh instead of retrying the same token.
  if (!store.accessTokenExpiresAt) return false
  return new Date(store.accessTokenExpiresAt).getTime() > Date.now() + 60_000
}

shopifyHttp.interceptors.response.use(
  (response) => response,
  async (error) => {
    const status = error.response?.status
    const config = error.config

    // Only handle genuine auth failures, and only ever retry a given
    // request once — if the retried request ALSO 401s, something deeper
    // is wrong (revoked app, invalid refresh token) and we should surface
    // the real error rather than loop.
    if (status !== 401 || !config || config._retriedAfterRefresh) {
      return Promise.reject(error)
    }

    const shopDomain = extractShopFromUrl(config.url)
    if (!shopDomain) return Promise.reject(error)

    try {
      const store = await Store.findOne({ shopDomain })
      if (!store || !store.getRefreshToken()) {
        // No refresh token on file — nothing we can do automatically.
        // Store predates this feature, or the merchant needs to reinstall.
        return Promise.reject(error)
      }

      const newAccessToken = await refreshOnce(store)

      config._retriedAfterRefresh = true
      if (config.headers?.["X-Shopify-Access-Token"]) {
        config.headers["X-Shopify-Access-Token"] = newAccessToken
      }
      return shopifyHttp(config)
    } catch (refreshErr) {
      logger.error(
        `Token refresh failed for ${shopDomain}: ${refreshErr.message}`,
        refreshErr.response?.data || refreshErr.stack,
      )
      return Promise.reject(error)
    }
  },
)

export default shopifyHttp
export { performRefresh as refreshAccessToken }
