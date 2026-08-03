import axios from "axios"
import Store from "../models/store.model.js"
import logger from "../config/logger.js"

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
async function refreshAccessToken(store) {
  const refreshToken = store.getRefreshToken()
  if (!refreshToken) {
    throw new Error(`No refresh token stored for ${store.shopDomain}`)
  }

  const response = await axios.post(
    `https://${store.shopDomain}/admin/oauth/access_token`,
    new URLSearchParams({
      client_id: process.env.SHOPIFY_API_KEY,
      client_secret: process.env.SHOPIFY_API_SECRET,
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

// Coalesce concurrent refresh attempts for the same store into one request.
// If several API calls fail at once because the token just expired, we do
// NOT want to fire several parallel refresh calls — Shopify invalidates
// the previous refresh token as soon as it's used once, so a second
// concurrent refresh attempt with that same (now-stale) refresh token
// would itself fail.
const refreshInFlight = new Map()

function refreshOnce(store) {
  const key = store.shopDomain
  if (refreshInFlight.has(key)) return refreshInFlight.get(key)
  const promise = refreshAccessToken(store).finally(() =>
    refreshInFlight.delete(key),
  )
  refreshInFlight.set(key, promise)
  return promise
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
      )
      return Promise.reject(error)
    }
  },
)

export default shopifyHttp
export { refreshAccessToken }
