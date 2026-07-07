import Product from "../models/product.model.js"
import ProductAnalysis from "../models/product-analysis.mode.js"
import ProductPrompt from "../models/product-prompt.model.js"
import * as shopifyService from "./shopify.service.js"
import logger from "../config/logger.js"

function pctChange(before, after) {
  if (before == null || after == null) return null
  if (before === 0) return after > 0 ? 100 : 0
  return Math.round(((after - before) / before) * 100)
}

function formatPct(value) {
  if (value == null) return null
  const sign = value >= 0 ? "+" : ""
  return `${sign}${value}%`
}

function formatDelta(before, after) {
  const delta = after - before
  if (delta === 0) return "0"
  const sign = delta > 0 ? "+" : ""
  return `${sign}${delta}`
}

function formatCurrency(value, currency = "USD") {
  if (value == null) return null
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(value)
  } catch {
    return `$${Math.round(value).toLocaleString()}`
  }
}

function formatNumber(value) {
  if (value == null) return null
  return Math.round(value).toLocaleString()
}

function isShopifyAccessError(err) {
  if (!err) return false
  const message = err.message || ""
  return (
    err.statusCode === 401 ||
    err.statusCode === 403 ||
    message.includes("access token") ||
    message.includes("invalid or expired") ||
    message.includes("scope") ||
    message.includes("permissions") ||
    message.includes("ShopifyQL")
  )
}

function buildEmptyMetricSet(intentsWon = 0) {
  return {
    intentsWon,
    revenue: 0,
    orders: 0,
    sessions: 0,
    views: 0,
    traffic: 0,
    conversionRate: null,
    source: "none",
  }
}

function getStoreCredentials(store) {
  const accessToken = store.accessToken
  // console.log("access token", accessToken)
  if (!accessToken) {
    throw new Error("Shopify access token not available for this store")
  }
  return { shop: store.shopDomain, accessToken }
}

async function getOptimizationMilestone(storeId) {
  const firstApplied = await ProductAnalysis.findOne({
    storeId,
    appliedToShopify: true,
    appliedAt: { $ne: null },
  })
    .sort({ appliedAt: 1 })
    .select("appliedAt")
    .lean()

  return firstApplied?.appliedAt || null
}

async function countIntentsWon(storeId, { beforeDate } = {}) {
  const filter = { storeId, visibility: "HIGH", isTracked: true }
  if (beforeDate) {
    filter.lastScoredAt = { $lte: beforeDate }
  }
  return ProductPrompt.countDocuments(filter)
}

async function countIntentsUnlocked(storeId, sinceDate) {
  if (!sinceDate) return 0

  const prompts = await ProductPrompt.find({
    storeId,
    visibility: "HIGH",
    isTracked: true,
  })
    .select("scoreHistory lastScoredAt")
    .lean()

  let unlocked = 0
  for (const prompt of prompts) {
    const history = prompt.scoreHistory || []
    if (!history.length) {
      if (prompt.lastScoredAt && new Date(prompt.lastScoredAt) >= sinceDate) {
        unlocked += 1
      }
      continue
    }

    const becameHigh = history.some((entry, index) => {
      if (entry.visibility !== "HIGH") return false
      const scoredAt = new Date(entry.scoredAt)
      if (scoredAt < sinceDate) return false
      const prev = index > 0 ? history[index - 1].visibility : "LOW"
      return prev !== "HIGH"
    })

    if (becameHigh) unlocked += 1
  }

  return unlocked
}

async function getIntentCountsForProduct(productId, appliedAt) {
  const prompts = await ProductPrompt.find({ productId, isTracked: true })
    .select("visibility scoreHistory")
    .lean()

  let after = 0
  let before = 0

  for (const prompt of prompts) {
    if (prompt.visibility === "HIGH") after += 1

    if (appliedAt && prompt.scoreHistory?.length) {
      const beforeEntry = [...prompt.scoreHistory]
        .reverse()
        .find((h) => new Date(h.scoredAt) <= appliedAt)
      if (beforeEntry?.visibility === "HIGH") before += 1
    } else if (prompt.visibility !== "HIGH") {
      // no history — treat non-HIGH as not won before optimization
    } else if (!appliedAt) {
      before = after
    }
  }

  if (!appliedAt) before = after

  return { before, after, unlocked: Math.max(0, after - before) }
}

function buildMetricCards({ before, after, intentsUnlocked }) {
  const trafficChange = pctChange(before.traffic, after.traffic)
  const conversionChange = pctChange(
    before.conversionRate,
    after.conversionRate,
  )
  const revenueChange = pctChange(before.revenue, after.revenue)

  return [
    {
      title: "Traffic",
      value: formatPct(trafficChange) || "—",
      subtitle: "vs previous period",
      rawChange: trafficChange,
    },
    {
      title: "Conversions",
      value: formatPct(conversionChange) || "—",
      subtitle: "vs previous period",
      rawChange: conversionChange,
    },
    {
      title: "Revenue",
      value: formatPct(revenueChange) || "—",
      subtitle: "vs previous period",
      rawChange: revenueChange,
    },
    {
      title: "Intents Unlocked",
      value:
        intentsUnlocked > 0 ? `+${intentsUnlocked}` : String(intentsUnlocked),
      subtitle: "new buyer intents matched",
      rawChange: intentsUnlocked,
    },
  ]
}

function buildBeforeAfterComparison({ before, after, currency }) {
  const intentsChange = formatDelta(before.intentsWon, after.intentsWon)

  return {
    before: [
      { title: "Intents Won", value: String(before.intentsWon) },
      {
        title: "Traffic",
        value: before.traffic != null ? formatNumber(before.traffic) : "—",
      },
      {
        title: "Revenue",
        value:
          before.revenue != null
            ? formatCurrency(before.revenue, currency)
            : "—",
      },
    ],
    after: [
      {
        title: "Intents Won",
        value: String(after.intentsWon),
        change: intentsChange !== "0" ? intentsChange : null,
      },
      {
        title: "Traffic",
        value: after.traffic != null ? formatNumber(after.traffic) : "—",
        change: formatPct(pctChange(before.traffic, after.traffic)),
      },
      {
        title: "Revenue",
        value:
          after.revenue != null ? formatCurrency(after.revenue, currency) : "—",
        change: formatPct(pctChange(before.revenue, after.revenue)),
      },
    ],
    highlights: {
      intentsUnlocked: Math.max(0, after.intentsWon - before.intentsWon),
      visibilityIncreasePercent: pctChange(before.intentsWon, after.intentsWon),
    },
  }
}

/**
 * Capture Shopify baseline metrics on a product right before optimization.
 */
async function captureProductBaseline(store, product) {
  const { shop, accessToken } = getStoreCredentials(store)
  const end = new Date()
  const start = new Date(end)
  start.setDate(start.getDate() - 7)

  const [salesByTitle, sessionByTitle, salesById] = await Promise.all([
    shopifyService.fetchProductSalesMetrics(shop, accessToken, start, end),
    shopifyService.fetchProductSessionMetrics(shop, accessToken, start, end),
    shopifyService.fetchProductSalesFromOrders(shop, accessToken, start, end),
  ])

  const titleKey = product.title.toLowerCase()
  const sales = salesByTitle[titleKey]
  const sessions = sessionByTitle[titleKey]
  const salesByProductId = salesById[product.shopifyProductId]

  const revenue = sales?.revenue ?? salesByProductId?.revenue ?? 0
  const orders = sales?.orders ?? salesByProductId?.orders ?? 0
  const traffic = sessions?.traffic ?? null
  const views = sessions?.views ?? null
  const conversionRate = sessions?.conversionRate ?? null

  await Product.findByIdAndUpdate(product._id, {
    "conversionMetrics.baseline": {
      conversionRate,
      orders,
      views,
      revenue,
      recordedAt: new Date(),
      source: sales?.source || salesByProductId?.source || "shopify",
    },
  })

  return { revenue, orders, views, traffic, conversionRate }
}

/**
 * GET /impact/summary — store-level before/after impact.
 */
async function getImpactSummary(store, { windowDays = 7 } = {}) {
  const storeId = store._id
  const { shop, accessToken } = getStoreCredentials(store)
  const milestone = await getOptimizationMilestone(storeId)
  const days = Math.min(Math.max(parseInt(windowDays, 10) || 7, 1), 90)

  const [beforeIntents, afterIntents, intentsUnlocked] = await Promise.all([
    milestone
      ? countIntentsWon(storeId, { beforeDate: milestone })
      : countIntentsWon(storeId),
    countIntentsWon(storeId),
    countIntentsUnlocked(storeId, milestone),
  ])

  let beforeMetrics
  let afterMetrics
  let periodLabel = "previous period"
  let dataSource = "shopify"

  try {
    if (milestone) {
      const beforeStart = new Date(milestone)
      beforeStart.setDate(beforeStart.getDate() - days)
      const beforeEnd = new Date(milestone)
      const afterStart = new Date(milestone)
      const afterEnd = new Date(milestone)
      afterEnd.setDate(afterEnd.getDate() + days)
      if (afterEnd > new Date()) afterEnd.setTime(Date.now())
      ;[beforeMetrics, afterMetrics] = await Promise.all([
        shopifyService.fetchStoreMetricsForRange(
          shop,
          accessToken,
          beforeStart,
          beforeEnd,
        ),
        shopifyService.fetchStoreMetricsForRange(
          shop,
          accessToken,
          afterStart,
          afterEnd,
        ),
      ])
      periodLabel = `${days} days before vs ${days} days after first optimization`
    } else {
      const comparison = await shopifyService.fetchStoreMetricsComparison(
        shop,
        accessToken,
        days,
      )
      beforeMetrics = comparison.previous
      afterMetrics = comparison.current
    }
  } catch (err) {
    if (isShopifyAccessError(err)) {
      logger.warn(
        `Shopify analytics unavailable for impact summary (${store.shopDomain}); using empty fallback`,
        err.message,
      )
      beforeMetrics = buildEmptyMetricSet(beforeIntents)
      afterMetrics = buildEmptyMetricSet(afterIntents)
      dataSource = "none"
    } else {
      throw err
    }
  }

  const before = {
    ...beforeMetrics,
    intentsWon: beforeIntents,
  }
  const after = {
    ...afterMetrics,
    intentsWon: afterIntents,
  }

  return {
    hasOptimizations: Boolean(milestone),
    optimizationStartedAt: milestone,
    periodLabel,
    dataSource: afterMetrics?.source || dataSource,
    metrics: buildMetricCards({ before, after, intentsUnlocked }),
    comparison: buildBeforeAfterComparison({
      before,
      after,
      currency: store.currency || "USD",
    }),
    raw: { before, after, intentsUnlocked },
  }
}

/**
 * GET /impact/products — per-product before/after table.
 */
async function getProductImpact(store, { windowDays = 7, limit = 20 } = {}) {
  const storeId = store._id
  const { shop, accessToken } = getStoreCredentials(store)
  const days = Math.min(Math.max(parseInt(windowDays, 10) || 7, 1), 90)
  const maxItems = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100)

  const products = await Product.find({ storeId, isOptimized: true })
    .sort({ updatedAt: -1 })
    .limit(maxItems)
    .lean()

  const results = []

  for (const product of products) {
    const analysis = await ProductAnalysis.findOne({
      productId: product._id,
      appliedToShopify: true,
      appliedAt: { $ne: null },
    })
      .sort({ appliedAt: -1 })
      .select("appliedAt")
      .lean()

    const appliedAt = analysis?.appliedAt
    if (!appliedAt) continue

    const beforeStart = new Date(appliedAt)
    beforeStart.setDate(beforeStart.getDate() - days)
    const beforeEnd = new Date(appliedAt)
    const afterStart = new Date(appliedAt)
    const afterEnd = new Date(appliedAt)
    afterEnd.setDate(afterEnd.getDate() + days)
    if (afterEnd > new Date()) afterEnd.setTime(Date.now())

    const titleKey = product.title.toLowerCase()

    let beforeSales
    let afterSales
    let beforeSessions
    let afterSessions
    let beforeRevenue
    let afterRevenue
    let growth
    let intentCounts

    try {
      ;[
        beforeSales,
        afterSales,
        beforeSessions,
        afterSessions,
        beforeRevenue,
        afterRevenue,
        intentCounts,
      ] = await Promise.all([
        shopifyService.fetchProductSalesMetrics(
          shop,
          accessToken,
          beforeStart,
          beforeEnd,
        ),
        shopifyService.fetchProductSalesMetrics(
          shop,
          accessToken,
          afterStart,
          afterEnd,
        ),
        shopifyService.fetchProductSessionMetrics(
          shop,
          accessToken,
          beforeStart,
          beforeEnd,
        ),
        shopifyService.fetchProductSessionMetrics(
          shop,
          accessToken,
          afterStart,
          afterEnd,
        ),
        shopifyService.fetchProductSalesFromOrders(
          shop,
          accessToken,
          beforeStart,
          beforeEnd,
        ),
        shopifyService.fetchProductSalesFromOrders(
          shop,
          accessToken,
          afterStart,
          afterEnd,
        ),
        getIntentCountsForProduct(product._id, appliedAt),
      ])

      const beforeSalesMap = beforeSales
      const afterSalesMap = afterSales
      const beforeSessionMap = beforeSessions
      const afterSessionMap = afterSessions
      const beforeOrdersMap = beforeRevenue
      const afterOrdersMap = afterRevenue

      const beforeSalesEntry =
        beforeSalesMap[titleKey] || beforeOrdersMap[product.shopifyProductId]
      const afterSalesEntry =
        afterSalesMap[titleKey] || afterOrdersMap[product.shopifyProductId]
      const beforeSessionEntry = beforeSessionMap[titleKey] || {}
      const afterSessionEntry = afterSessionMap[titleKey] || {}

      beforeRevenue =
        beforeSalesEntry?.revenue ??
        product.conversionMetrics?.baseline?.revenue ??
        0
      afterRevenue =
        afterSalesEntry?.revenue ??
        product.conversionMetrics?.postOptimization?.revenue ??
        0
      growth = pctChange(beforeRevenue, afterRevenue)
    } catch (err) {
      if (!isShopifyAccessError(err)) throw err
      logger.warn(
        `Shopify analytics unavailable for product impact (${product.title}); using empty fallback`,
        err.message,
      )
      beforeRevenue = 0
      afterRevenue = 0
      growth = 0
      intentCounts = { before: 0, after: 0, unlocked: 0 }
      beforeSessions = {}
      afterSessions = {}
    }

    results.push({
      id: product._id,
      productId: product._id,
      shopifyProductId: product.shopifyProductId,
      product: product.title,
      optimizedAt: appliedAt,
      before: {
        intents: intentCounts?.before ?? 0,
        revenue: beforeRevenue,
        traffic: beforeSessions?.traffic ?? null,
        orders: beforeSales?.[titleKey]?.orders ?? 0,
      },
      after: {
        intents: intentCounts?.after ?? 0,
        revenue: afterRevenue,
        traffic: afterSessions?.[titleKey]?.traffic ?? null,
        orders: afterSales?.[titleKey]?.orders ?? 0,
      },
      growth,
      action: product.isOptimized ? "View Product" : "Apply Fix",
    })
  }

  results.sort((a, b) => (b.growth ?? 0) - (a.growth ?? 0))

  return {
    products: results,
    windowDays: days,
    dataSource: results.length ? "shopify" : "none",
  }
}

/**
 * GET /impact/opportunities — top intent/fix gains linked to Shopify performance.
 */
async function getTopOpportunities(store, { windowDays = 7, limit = 10 } = {}) {
  const storeId = store._id
  const { shop, accessToken } = getStoreCredentials(store)
  const days = Math.min(Math.max(parseInt(windowDays, 10) || 7, 1), 90)
  const maxItems = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 50)

  const optimizedProducts = await Product.find({ storeId, isOptimized: true })
    .select("_id title shopifyProductId")
    .lean()

  const productIds = optimizedProducts.map((p) => p._id)
  const productById = Object.fromEntries(
    optimizedProducts.map((p) => [p._id.toString(), p]),
  )

  const prompts = await ProductPrompt.find({
    storeId,
    productId: { $in: productIds },
    visibility: "HIGH",
    isTracked: true,
  })
    .select("prompt buyerIntent productId scoreHistory visibility")
    .lean()

  const opportunities = []

  for (const prompt of prompts) {
    const product = productById[prompt.productId.toString()]
    if (!product) continue

    const analysis = await ProductAnalysis.findOne({
      productId: product._id,
      appliedToShopify: true,
      appliedAt: { $ne: null },
    })
      .sort({ appliedAt: -1 })
      .select("appliedAt prioritizedFixes")
      .lean()

    if (!analysis?.appliedAt) continue

    const wasHighBefore = (prompt.scoreHistory || []).some(
      (h) =>
        h.visibility === "HIGH" &&
        new Date(h.scoredAt) <= new Date(analysis.appliedAt),
    )
    if (wasHighBefore) continue

    const afterStart = new Date(analysis.appliedAt)
    const afterEnd = new Date(analysis.appliedAt)
    afterEnd.setDate(afterEnd.getDate() + days)
    if (afterEnd > new Date()) afterEnd.setTime(Date.now())

    const beforeStart = new Date(analysis.appliedAt)
    beforeStart.setDate(beforeStart.getDate() - days)
    const beforeEnd = new Date(analysis.appliedAt)

    const titleKey = product.title.toLowerCase()
    let beforeSessions
    let afterSessions
    let beforeSales
    let afterSales
    let trafficChange = null
    let conversionChange = null
    let revenueChange = null

    try {
      ;[beforeSessions, afterSessions, beforeSales, afterSales] =
        await Promise.all([
          shopifyService.fetchProductSessionMetrics(
            shop,
            accessToken,
            beforeStart,
            beforeEnd,
          ),
          shopifyService.fetchProductSessionMetrics(
            shop,
            accessToken,
            afterStart,
            afterEnd,
          ),
          shopifyService.fetchProductSalesMetrics(
            shop,
            accessToken,
            beforeStart,
            beforeEnd,
          ),
          shopifyService.fetchProductSalesMetrics(
            shop,
            accessToken,
            afterStart,
            afterEnd,
          ),
        ])

      const before = beforeSessions[titleKey] || {}
      const after = afterSessions[titleKey] || {}
      const beforeRev = beforeSales[titleKey]?.revenue ?? 0
      const afterRev = afterSales[titleKey]?.revenue ?? 0

      trafficChange = pctChange(before.traffic, after.traffic)
      conversionChange = pctChange(before.conversionRate, after.conversionRate)
      revenueChange = pctChange(beforeRev, afterRev)
    } catch (err) {
      if (!isShopifyAccessError(err)) throw err
      logger.warn(
        `Shopify analytics unavailable for opportunities (${product.title}); skipping metrics`,
        err.message,
      )
    }

    const impactParts = []
    if (trafficChange != null)
      impactParts.push(`Traffic: ${formatPct(trafficChange)}`)
    if (conversionChange != null)
      impactParts.push(`Conversions: ${formatPct(conversionChange)}`)
    if (revenueChange != null)
      impactParts.push(`Revenue: ${formatPct(revenueChange)}`)

    const keyword = prompt.prompt || prompt.buyerIntent
    opportunities.push({
      keyword,
      productId: product._id,
      productTitle: product.title,
      impact: impactParts[0] || "Intent matched after optimization",
      impact2: impactParts[1] || null,
      priority: "HIGH",
      metrics: {
        trafficChange,
        conversionChange,
        revenueChange,
      },
      detail: `Performance improved after optimization for "${keyword}". Products matching this buyer intent saw gains across traffic, add-to-cart, and order metrics in the ${days} days following the fix.`,
      optimizedAt: analysis.appliedAt,
    })
  }

  opportunities.sort((a, b) => {
    const scoreA =
      Math.abs(a.metrics.revenueChange || 0) +
      Math.abs(a.metrics.trafficChange || 0)
    const scoreB =
      Math.abs(b.metrics.revenueChange || 0) +
      Math.abs(b.metrics.trafficChange || 0)
    return scoreB - scoreA
  })

  return {
    opportunities: opportunities.slice(0, maxItems),
    windowDays: days,
  }
}

/**
 * Record post-optimization Shopify metrics for a product (called after apply).
 */
async function recordProductPostOptimization(
  store,
  product,
  appliedAt = new Date(),
) {
  try {
    const { shop, accessToken } = getStoreCredentials(store)
    const end = new Date()
    const start = new Date(appliedAt)

    const titleKey = product.title.toLowerCase()
    const [salesMap, sessionMap, ordersMap] = await Promise.all([
      shopifyService.fetchProductSalesMetrics(shop, accessToken, start, end),
      shopifyService.fetchProductSessionMetrics(shop, accessToken, start, end),
      shopifyService.fetchProductSalesFromOrders(shop, accessToken, start, end),
    ])

    const sales = salesMap[titleKey] || ordersMap[product.shopifyProductId]
    const sessions = sessionMap[titleKey] || {}

    const post = {
      conversionRate: sessions.conversionRate ?? null,
      orders: sales?.orders ?? 0,
      views: sessions.views ?? null,
      revenue: sales?.revenue ?? 0,
      recordedAt: new Date(),
      source: sales?.source || "shopify",
    }

    const baseline = product.conversionMetrics?.baseline || {}
    const revenueGrowthPercent = pctChange(baseline.revenue, post.revenue)
    const conversionGrowthPercent = pctChange(
      baseline.conversionRate,
      post.conversionRate,
    )

    await Product.findByIdAndUpdate(product._id, {
      "conversionMetrics.postOptimization": post,
      "conversionMetrics.revenueGrowthPercent": revenueGrowthPercent,
      "conversionMetrics.conversionGrowthPercent": conversionGrowthPercent,
    })

    return post
  } catch (err) {
    logger.warn(
      `Could not record post-optimization metrics for product ${product._id}:`,
      err.message,
    )
    return null
  }
}

export {
  getImpactSummary,
  getProductImpact,
  getTopOpportunities,
  captureProductBaseline,
  recordProductPostOptimization,
  pctChange,
}
