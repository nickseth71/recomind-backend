import * as analytics from "./analytics.service.js"
import {
  buildImpactWindows,
  hasMinimumElapsed,
  normalizeWindowDays,
} from "../utils/dateWindow.util.js"

const CACHE_TTL_MS = 15 * 60 * 1000
const impactCache = new Map()

function buildCacheKey(storeId, productId, windowDays) {
  return `${storeId}:${productId || "store"}:${windowDays}`
}

function getCachedImpact(cacheKey) {
  const cached = impactCache.get(cacheKey)
  if (!cached) return null
  if (Date.now() > cached.expiresAt) {
    impactCache.delete(cacheKey)
    return null
  }
  return cached.value
}

function setCachedImpact(cacheKey, value) {
  impactCache.set(cacheKey, {
    value,
    expiresAt: Date.now() + CACHE_TTL_MS,
  })
}

function getLatestSnapshot(history = [], cutoffDate) {
  const cutoff = new Date(cutoffDate).getTime()
  let latest = null
  let latestTs = -Infinity

  for (const snapshot of history) {
    const scoredAt = new Date(snapshot.scoredAt).getTime()
    if (Number.isFinite(scoredAt) && scoredAt <= cutoff && scoredAt > latestTs) {
      latest = snapshot
      latestTs = scoredAt
    }
  }

  return latest
}

function countIntentsUnlocked(prompts, anchorDate, afterEndDate) {
  const anchorTs = new Date(anchorDate).getTime()
  const afterEndTs = new Date(afterEndDate).getTime()
  if (!Number.isFinite(anchorTs) || !Number.isFinite(afterEndTs)) return 0

  let count = 0
  for (const prompt of prompts) {
    const history = prompt.scoreHistory || []
    const beforeSnapshot = getLatestSnapshot(history, anchorTs)
    const afterSnapshot = getLatestSnapshot(history, afterEndTs)

    if (
      beforeSnapshot &&
      afterSnapshot &&
      beforeSnapshot.visibility !== "HIGH" &&
      afterSnapshot.visibility === "HIGH"
    ) {
      count += 1
    }
  }

  return count
}

function computeDeltaPct(beforeRevenue, afterRevenue) {
  if (!beforeRevenue || beforeRevenue === 0) return null
  return Number((((afterRevenue - beforeRevenue) / beforeRevenue) * 100).toFixed(2))
}

// Distinguishes WHY the Shopify call failed so the frontend (and you, in the
// demo) can tell "token expired" apart from "Shopify is rate-limiting us"
// apart from "something genuinely broke."
function classifyFetchError(err) {
  const status = err?.response?.status ?? err?.statusCode
  if (status === 401 || status === 403) return "shopify_auth_error"
  if (status === 429) return "shopify_rate_limited"
  return "shopify_fetch_error"
}

export async function getImpactData(store, { productId, windowDays } = {}) {
  const normalizedWindowDays = normalizeWindowDays(windowDays)
  const cacheKey = buildCacheKey(store._id, productId, normalizedWindowDays)
  const cached = getCachedImpact(cacheKey)
  if (cached) {
    return cached
  }

  let shopifyProductId = null
  if (productId) {
    const product = await analytics.getProductById(productId, store._id)
    if (!product) {
      const error = new Error("Product not found")
      error.statusCode = 404
      throw error
    }
    shopifyProductId = product.shopifyProductId
  }

  const anchor = await analytics.findFirstAppliedAnalysis(store._id, productId)
  if (!anchor) {
    const result = {
      anchor: null,
      revenue: {
        status: "insufficient_data",
        before: { revenue: 0, orders: 0 },
        after: { revenue: 0, orders: 0 },
        deltaPct: null,
      },
      intentsUnlocked: { status: "insufficient_data", count: 0 },
      traffic: { status: "not_implemented" },
      conversionRate: { status: "not_implemented" },
    }
    setCachedImpact(cacheKey, result)
    return result
  }

  const windows = buildImpactWindows(anchor, normalizedWindowDays, store.installedAt)

  // --- Revenue (Shopify-dependent — isolated so a token failure can't kill the whole response) ---
  let revenue
  let revenueFetchFailed = false

  try {
    const [beforeOrders, afterOrders] = await Promise.all([
      analytics.fetchOrdersInRange(
        store.shopDomain,
        store.accessToken,
        windows.beforeStart,
        windows.beforeEnd,
        { includeLineItems: Boolean(productId) },
      ),
      analytics.fetchOrdersInRange(
        store.shopDomain,
        store.accessToken,
        windows.afterStart,
        windows.afterEnd,
        { includeLineItems: Boolean(productId) },
      ),
    ])

    const beforeRevenue = productId
      ? analytics.sumRevenueForProduct(beforeOrders, shopifyProductId)
      : analytics.sumRevenue(beforeOrders)

    const afterRevenue = productId
      ? analytics.sumRevenueForProduct(afterOrders, shopifyProductId)
      : analytics.sumRevenue(afterOrders)

    const beforeOrdersCount = productId
      ? analytics.countOrdersContainingProduct(beforeOrders, shopifyProductId)
      : beforeOrders.length

    const afterOrdersCount = productId
      ? analytics.countOrdersContainingProduct(afterOrders, shopifyProductId)
      : afterOrders.length

    const beforeWindowEnough = hasMinimumElapsed(
      { start: windows.beforeStart, end: windows.beforeEnd },
      3,
    )
    const afterWindowEnough = hasMinimumElapsed(
      { start: windows.afterStart, end: windows.afterEnd },
      3,
    )

    const windowStatus =
      beforeWindowEnough && afterWindowEnough ? "ok" : "insufficient_data"

    revenue = {
      status: windowStatus,
      before: { revenue: beforeRevenue, orders: beforeOrdersCount },
      after: { revenue: afterRevenue, orders: afterOrdersCount },
      deltaPct: windowStatus === "ok" ? computeDeltaPct(beforeRevenue, afterRevenue) : null,
    }
  } catch (err) {
    revenueFetchFailed = true
    revenue = {
      status: classifyFetchError(err),
      before: null,
      after: null,
      deltaPct: null,
    }
  }

  // --- Intents Unlocked (internal only — never touches Shopify, always computed) ---
  const intents = await analytics.findProductPromptsForStore(store._id, productId)
  const intentsCount = countIntentsUnlocked(intents, anchor, windows.afterEnd)

  const result = {
    anchor,
    revenue,
    intentsUnlocked: { status: "ok", count: intentsCount },
    traffic: { status: "not_implemented" },
    conversionRate: { status: "not_implemented" },
  }

  // Don't cache a transient Shopify failure — once the token's fixed, the
  // next request should hit live data immediately, not wait out a stale TTL.
  if (!revenueFetchFailed) {
    setCachedImpact(cacheKey, result)
  }

  return result
}