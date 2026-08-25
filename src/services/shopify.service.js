// import axios from "axios"
// import crypto from "crypto"
// import logger from "../config/logger.js"

// const SHOPIFY_API_VERSION = "2025-10"
// const RECOMIND_METAFIELD_NAMESPACE = "RecoMind"

// /**
//  * Build the Shopify OAuth authorisation URL.
//  * Redirect the merchant to this URL to begin OAuth.
//  */
// function buildAuthUrl(shop, state) {
//   const { SHOPIFY_API_KEY, SHOPIFY_SCOPES, SHOPIFY_REDIRECT_URI } = process.env
//   const params = new URLSearchParams({
//     client_id: SHOPIFY_API_KEY,
//     scope: SHOPIFY_SCOPES,
//     redirect_uri: SHOPIFY_REDIRECT_URI,
//     state,
//     "grant_options[]": "per-user",
//   })
//   return `https://${shop}/admin/oauth/authorize?${params.toString()}`
// }

// /**
//  * Exchange the OAuth code for a permanent access token.
//  */
// async function exchangeCodeForToken(shop, code) {
//   const { SHOPIFY_API_KEY, SHOPIFY_API_SECRET } = process.env
//   const res = await axios.post(`https://${shop}/admin/oauth/access_token`, {
//     client_id: SHOPIFY_API_KEY,
//     client_secret: SHOPIFY_API_SECRET,
//     code,
//   })
//   return res.data.access_token
// }

// /**
//  * Verify the HMAC signature from Shopify on the OAuth callback.
//  */
// function verifyHmac(query) {
//   const { hmac, ...rest } = query
//   const message = Object.keys(rest)
//     .sort()
//     .map((k) => `${k}=${Array.isArray(rest[k]) ? rest[k].join(",") : rest[k]}`)
//     .join("&")
//   const expected = crypto
//     .createHmac("sha256", process.env.SHOPIFY_API_SECRET)
//     .update(message)
//     .digest("hex")
//   return crypto.timingSafeEqual(
//     Buffer.from(expected, "hex"),
//     Buffer.from(hmac, "hex"),
//   )
// }

// /**
//  * Verify webhook HMAC from Shopify.
//  */
// function verifyWebhookHmac(rawBody, hmacHeader) {
//   const expected = crypto
//     .createHmac("sha256", process.env.SHOPIFY_WEBHOOK_SECRET)
//     .update(rawBody)
//     .digest("base64")
//   return crypto.timingSafeEqual(
//     Buffer.from(expected, "base64"),
//     Buffer.from(hmacHeader, "base64"),
//   )
// }

// /**
//  * Fetch collections for a product.
//  */
// async function fetchProductCollections(shop, accessToken, shopifyProductId) {
//   try {
//     const res = await axios.get(
//       `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/products/${shopifyProductId}/collections.json?fields=id,title,handle`,
//       { headers: { "X-Shopify-Access-Token": accessToken } },
//     )
//     return (res.data.collections || []).map((c) => ({
//       shopifyCollectionId: String(c.id),
//       title: c.title,
//       handle: c.handle,
//     }))
//   } catch (err) {
//     logger.warn(
//       `Could not fetch collections for product ${shopifyProductId}:`,
//       err.message,
//     )
//     return []
//   }
// }

// /**
//  * Parse review data from product metafields (Judge.me, Loox, Yotpo, etc.).
//  */
// function parseReviewsFromMetafields(metafields) {
//   const reviewKeys = [
//     "reviews",
//     "review",
//     "product_reviews",
//     "judgeme_reviews",
//     "loox_reviews",
//     "stamped_reviews",
//     "yotpo_reviews",
//   ]

//   const reviews = []
//   for (const mf of metafields || []) {
//     const key = (mf.key || "").toLowerCase()
//     if (
//       !reviewKeys.some(
//         (k) => key.includes(k.replace("_reviews", "")) || key === k,
//       )
//     ) {
//       if (!key.includes("review")) continue
//     }

//     try {
//       const parsed = JSON.parse(mf.value)
//       if (Array.isArray(parsed)) {
//         parsed.forEach((r) => {
//           const body = r.body || r.content || r.review || r.text
//           if (body) {
//             reviews.push({
//               rating: Number(r.rating || r.score || r.stars) || null,
//               body: String(body).slice(0, 500),
//               author: r.author || r.name || r.reviewer || "Customer",
//               date:
//                 r.date || r.created_at
//                   ? new Date(r.date || r.created_at)
//                   : null,
//               source: mf.namespace || "metafield",
//             })
//           }
//         })
//       }
//     } catch {
//       if (typeof mf.value === "string" && mf.value.length > 20) {
//         reviews.push({
//           rating: null,
//           body: mf.value.slice(0, 500),
//           author: "Customer",
//           source: mf.namespace || "metafield",
//         })
//       }
//     }
//   }
//   return reviews.slice(0, 50)
// }

// /**
//  * Map metafields to a simplified store-friendly format.
//  */
// function mapProductMetafields(metafields) {
//   return (metafields || [])
//     .filter((m) => m.key !== "faqs" && m.key !== "faq")
//     .map((m) => ({
//       namespace: m.namespace,
//       key: m.key,
//       value: String(m.value || "").slice(0, 2000),
//       type: m.type,
//     }))
//     .slice(0, 30)
// }

// /**
//  * Fetch paginated products from Shopify.
//  * Returns all products across all pages.
//  */
// async function fetchAllProducts(shop, accessToken) {
//   let products = []
//   let url = `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/products.json?limit=250&fields=id,title,body_html,tags,variants,images,product_type,vendor,handle,status,created_at,updated_at`

//   while (url) {
//     const res = await axios.get(url, {
//       headers: { "X-Shopify-Access-Token": accessToken },
//     })
//     products = products.concat(res.data.products)

//     // Handle link header pagination
//     const linkHeader = res.headers["link"]
//     url = null
//     if (linkHeader) {
//       const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/)
//       if (nextMatch) url = nextMatch[1]
//     }
//   }

//   logger.info(`Fetched ${products.length} products from ${shop}`)
//   return products
// }

// /**
//  * Fetch a single product from Shopify by its ID.
//  */
// async function fetchProduct(shop, accessToken, shopifyProductId) {
//   const res = await axios.get(
//     `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/products/${shopifyProductId}.json`,
//     { headers: { "X-Shopify-Access-Token": accessToken } },
//   )
//   return res.data.product
// }

// /**
//  * Fetch product metafields (for FAQ detection).
//  */
// async function fetchProductMetafields(shop, accessToken, shopifyProductId) {
//   try {
//     const res = await axios.get(
//       `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/products/${shopifyProductId}/metafields.json`,
//       { headers: { "X-Shopify-Access-Token": accessToken } },
//     )
//     return res.data.metafields || []
//   } catch (err) {
//     logger.warn(
//       `Could not fetch metafields for product ${shopifyProductId}:`,
//       err.message,
//     )
//     return []
//   }
// }

// /**
//  * Parse FAQ data from product metafields.
//  * Supports RecoMind namespace and common FAQ app formats.
//  */
// function parseFaqsFromMetafields(metafields) {
//   const faqMetafields = (metafields || []).filter(
//     (m) =>
//       m.key === "faqs" ||
//       m.key === "faq" ||
//       m.key === "product_faq" ||
//       (m.namespace === "faq" && m.type?.includes("json")),
//   )

//   for (const mf of faqMetafields) {
//     try {
//       const parsed = JSON.parse(mf.value)
//       if (Array.isArray(parsed)) {
//         return parsed
//           .map((item) => ({
//             question: item.question || item.q || item.title,
//             answer: item.answer || item.a || item.content,
//             source: "metafield",
//             metafieldId: mf.id,
//           }))
//           .filter((f) => f.question && f.answer)
//       }
//     } catch {
//       // not JSON — skip
//     }
//   }
//   return []
// }

// /**
//  * Create or update RecoMind FAQ metafield on a product.
//  */
// async function upsertProductFaqMetafield(
//   shop,
//   accessToken,
//   shopifyProductId,
//   faqs,
// ) {
//   const metafields = await fetchProductMetafields(
//     shop,
//     accessToken,
//     shopifyProductId,
//   )
//   const existing = metafields.find(
//     (m) => m.namespace === RECOMIND_METAFIELD_NAMESPACE && m.key === "faqs",
//   )

//   const payload = {
//     metafield: {
//       namespace: RECOMIND_METAFIELD_NAMESPACE,
//       key: "faqs",
//       value: JSON.stringify(faqs),
//       type: "json",
//     },
//   }

//   if (existing) {
//     const res = await axios.put(
//       `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/metafields/${existing.id}.json`,
//       {
//         metafield: {
//           id: existing.id,
//           value: JSON.stringify(faqs),
//           type: "json",
//         },
//       },
//       { headers: { "X-Shopify-Access-Token": accessToken } },
//     )
//     return res.data.metafield
//   }

//   const res = await axios.post(
//     `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/products/${shopifyProductId}/metafields.json`,
//     payload,
//     { headers: { "X-Shopify-Access-Token": accessToken } },
//   )
//   return res.data.metafield
// }

// /**
//  * Update a product's title, body_html, and tags in Shopify.
//  */
// async function updateProduct(shop, accessToken, shopifyProductId, payload) {
//   const res = await axios.put(
//     `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/products/${shopifyProductId}.json`,
//     { product: payload },
//     {
//       headers: {
//         "X-Shopify-Access-Token": accessToken,
//         "Content-Type": "application/json",
//       },
//     },
//   )
//   return res.data.product
// }

// /**
//  * Get basic shop info (name, email, owner, currency, etc.)
//  */
// async function fetchShopInfo(shop, accessToken) {
//   const res = await axios.get(`https://${shop}/admin/api/2024-01/shop.json`, {
//     headers: { "X-Shopify-Access-Token": accessToken },
//   })
//   return res.data.shop
// }

// async function fetchMarkets(shop, accessToken) {
//   const query = `
//     query {
//       markets(first: 50) {
//         edges {
//           node {
//             id
//             name
//             enabled
//             primary
//             regions(first: 50) {
//               edges {
//                 node {
//                   ... on MarketRegionCountry {
//                     name
//                     code
//                   }
//                 }
//               }
//             }
//           }
//         }
//       }
//     }
//   `

//   const res = await axios.post(
//     `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
//     { query },
//     {
//       headers: {
//         "X-Shopify-Access-Token": accessToken,
//         "Content-Type": "application/json",
//       },
//     },
//   )

//   const edges = res.data?.data?.markets?.edges ?? []
//   return edges.map(({ node }) => ({
//     marketId: node.id,
//     name: node.name,
//     enabled: node.enabled,
//     primary: node.primary,
//     regions: (node.regions?.edges ?? []).map(({ node: r }) => ({
//       code: r.code,
//       name: r.name,
//     })),
//   }))
// }

// /**
//  * Execute a GraphQL Admin API query.
//  */
// async function graphqlQuery(shop, accessToken, query, variables = {}) {
//   try {
//     const res = await axios.post(
//       `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
//       { query, variables },
//       {
//         headers: {
//           "X-Shopify-Access-Token": accessToken,
//           "Content-Type": "application/json",
//         },
//       },
//     )

//     if (res.data.errors?.length) {
//       throw new Error(res.data.errors.map((e) => e.message).join(", "))
//     }

//     return res.data.data
//   } catch (err) {
//     // Surface Shopify API HTTP errors with clearer messages and status codes
//     const status = err?.response?.status
//     if (status === 403) {
//       const e = new Error(
//         "Shopify analytics access forbidden: missing read_reports scope or insufficient permissions",
//       )
//       e.statusCode = 403
//       throw e
//     }
//     if (status === 401) {
//       const e = new Error("Shopify access token invalid or expired (401)")
//       e.statusCode = 401
//       throw e
//     }

//     // Pass through other errors
//     throw err
//   }
// }

// /**
//  * Parse ShopifyQL tableData rows into plain objects.
//  */
// function parseShopifyqlTable(tableData) {
//   if (!tableData?.rows?.length) return []
//   const columns = (tableData.columns || []).map((c) => c.name)
//   return tableData.rows.map((row) => {
//     if (row && typeof row === "object" && !Array.isArray(row)) return row
//     const obj = {}
//     columns.forEach((col, i) => {
//       obj[col] = row[col] ?? row[i]
//     })
//     return obj
//   })
// }

// /**
//  * Run a ShopifyQL query via the GraphQL Admin API (requires read_reports scope).
//  */
// async function shopifyqlQuery(shop, accessToken, shopifyql) {
//   const query = `
//     query RunShopifyql($query: String!) {
//       shopifyqlQuery(query: $query) {
//         tableData {
//           columns { name dataType displayName }
//           rows
//         }
//         parseErrors
//       }
//     }
//   `

//   const data = await graphqlQuery(shop, accessToken, query, {
//     query: shopifyql,
//   })
//   const result = data?.shopifyqlQuery

//   if (!result) {
//     throw new Error("ShopifyQL query returned no data")
//   }

//   if (result.parseErrors?.length) {
//     throw new Error(result.parseErrors.join(", "))
//   }

//   return parseShopifyqlTable(result.tableData)
// }

// function toNumber(value) {
//   const n = Number(String(value ?? "").replace(/[^0-9.-]/g, ""))
//   return Number.isFinite(n) ? n : 0
// }

// function formatShopifyqlDate(date) {
//   return date.toISOString().slice(0, 10)
// }

// /**
//  * Store-wide commerce metrics for a date range from ShopifyQL.
//  */
// async function fetchStoreMetricsForRange(
//   shop,
//   accessToken,
//   startDate,
//   endDate,
// ) {
//   const since = formatShopifyqlDate(startDate)
//   const until = formatShopifyqlDate(endDate)
//   const query = `FROM sales, sessions SHOW total_sales, orders, sessions, product_views SINCE ${since} UNTIL ${until}`

//   try {
//     const rows = await shopifyqlQuery(shop, accessToken, query)
//     const row = rows[0] || {}
//     const orders = toNumber(row.orders)
//     const sessions = toNumber(row.sessions)
//     const views = toNumber(row.product_views)
//     const revenue = toNumber(row.total_sales)

//     return {
//       revenue,
//       orders,
//       sessions,
//       views,
//       traffic: sessions || views,
//       conversionRate:
//         sessions > 0 ? Math.round((orders / sessions) * 10000) / 100 : null,
//       source: "shopify",
//     }
//   } catch (err) {
//     logger.warn(`ShopifyQL store metrics failed for ${shop}:`, err.message)
//     return fetchStoreMetricsFromOrders(shop, accessToken, startDate, endDate)
//   }
// }

// /**
//  * Compare current period vs previous period using ShopifyQL COMPARE.
//  */
// async function fetchStoreMetricsComparison(shop, accessToken, days = 30) {
//   const query = `FROM sales, sessions SHOW total_sales, orders, sessions, product_views SINCE -${days}d COMPARE TO previous_period`

//   try {
//     const rows = await shopifyqlQuery(shop, accessToken, query)
//     const current =
//       rows.find((r) => r.period === "current_period") || rows[0] || {}
//     const previous =
//       rows.find((r) => r.period === "previous_period") || rows[1] || {}

//     const mapRow = (row) => {
//       const orders = toNumber(row.orders)
//       const sessions = toNumber(row.sessions)
//       const views = toNumber(row.product_views)
//       return {
//         revenue: toNumber(row.total_sales),
//         orders,
//         sessions,
//         views,
//         traffic: sessions || views,
//         conversionRate:
//           sessions > 0 ? Math.round((orders / sessions) * 10000) / 100 : null,
//         source: "shopify",
//       }
//     }

//     return {
//       current: mapRow(current),
//       previous: mapRow(previous),
//       source: "shopify",
//     }
//   } catch (err) {
//     logger.warn(`ShopifyQL comparison failed for ${shop}:`, err.message)
//     const end = new Date()
//     const start = new Date(end)
//     start.setDate(start.getDate() - days)
//     const prevEnd = new Date(start)
//     prevEnd.setDate(prevEnd.getDate() - 1)
//     const prevStart = new Date(prevEnd)
//     prevStart.setDate(prevStart.getDate() - days)

//     const [current, previous] = await Promise.all([
//       fetchStoreMetricsFromOrders(shop, accessToken, start, end),
//       fetchStoreMetricsFromOrders(shop, accessToken, prevStart, prevEnd),
//     ])

//     return { current, previous, source: "shopify_orders" }
//   }
// }

// /**
//  * Per-product sales metrics grouped by product title (ShopifyQL).
//  */
// async function fetchProductSalesMetrics(shop, accessToken, startDate, endDate) {
//   const since = formatShopifyqlDate(startDate)
//   const until = formatShopifyqlDate(endDate)
//   const query = `FROM sales SHOW total_sales, orders GROUP BY product_title SINCE ${since} UNTIL ${until} ORDER BY total_sales DESC LIMIT 250`

//   try {
//     const rows = await shopifyqlQuery(shop, accessToken, query)
//     const byTitle = {}
//     for (const row of rows) {
//       const title = row.product_title
//       if (!title) continue
//       byTitle[title.toLowerCase()] = {
//         title,
//         revenue: toNumber(row.total_sales),
//         orders: toNumber(row.orders),
//         source: "shopify",
//       }
//     }
//     return byTitle
//   } catch (err) {
//     logger.warn(`ShopifyQL product sales failed for ${shop}:`, err.message)
//     return fetchProductSalesFromOrders(shop, accessToken, startDate, endDate)
//   }
// }

// /**
//  * Per-product session funnel metrics (traffic, views, conversions).
//  */
// async function fetchProductSessionMetrics(
//   shop,
//   accessToken,
//   startDate,
//   endDate,
// ) {
//   const since = formatShopifyqlDate(startDate)
//   const until = formatShopifyqlDate(endDate)
//   const query = `FROM sessions SHOW sessions, product_views, add_to_carts, checkouts, orders GROUP BY product_title SINCE ${since} UNTIL ${until} ORDER BY sessions DESC LIMIT 250`

//   try {
//     const rows = await shopifyqlQuery(shop, accessToken, query)
//     const byTitle = {}
//     for (const row of rows) {
//       const title = row.product_title
//       if (!title) continue
//       const sessions = toNumber(row.sessions)
//       const orders = toNumber(row.orders)
//       byTitle[title.toLowerCase()] = {
//         title,
//         sessions,
//         views: toNumber(row.product_views),
//         addToCarts: toNumber(row.add_to_carts),
//         checkouts: toNumber(row.checkouts),
//         orders,
//         traffic: sessions || toNumber(row.product_views),
//         conversionRate:
//           sessions > 0 ? Math.round((orders / sessions) * 10000) / 100 : null,
//         source: "shopify",
//       }
//     }
//     return byTitle
//   } catch (err) {
//     logger.warn(`ShopifyQL product sessions failed for ${shop}:`, err.message)
//     return {}
//   }
// }

// /**
//  * Aggregate order line items by Shopify product ID (read_orders fallback).
//  */
// async function fetchOrdersInRange(shop, accessToken, startDate, endDate) {
//   let url = `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/orders.json?status=any&limit=250&fields=id,created_at,line_items,financial_status`
//   if (startDate) url += `&created_at_min=${startDate.toISOString()}`
//   if (endDate) url += `&created_at_max=${endDate.toISOString()}`

//   const orders = []
//   try {
//     while (url) {
//       const res = await axios.get(url, {
//         headers: { "X-Shopify-Access-Token": accessToken },
//       })
//       orders.push(...(res.data.orders || []))

//       const linkHeader = res.headers.link
//       url = null
//       if (linkHeader) {
//         const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/)
//         if (nextMatch) url = nextMatch[1]
//       }
//     }
//   } catch (err) {
//     const status = err?.response?.status
//     // Provide clearer error messages for common Shopify API issues
//     if (status === 403) {
//       const e = new Error(
//         "Shopify API access forbidden: access token lacks required scopes (e.g., read_orders) or permissions",
//       )
//       e.statusCode = 403
//       e.response = err.response
//       throw e
//     }
//     if (status === 401) {
//       const e = new Error(
//         "Shopify API unauthorized: access token invalid or expired",
//       )
//       e.statusCode = 401
//       e.response = err.response
//       throw e
//     }

//     throw err
//   }

//   return orders
// }

// async function fetchStoreMetricsFromOrders(
//   shop,
//   accessToken,
//   startDate,
//   endDate,
// ) {
//   const orders = await fetchOrdersInRange(shop, accessToken, startDate, endDate)
//   let revenue = 0
//   let orderCount = 0

//   for (const order of orders) {
//     if (["voided", "refunded"].includes(order.financial_status)) continue
//     orderCount += 1
//     for (const item of order.line_items || []) {
//       revenue += toNumber(item.price) * toNumber(item.quantity)
//     }
//   }

//   return {
//     revenue: Math.round(revenue * 100) / 100,
//     orders: orderCount,
//     sessions: null,
//     views: null,
//     traffic: null,
//     conversionRate: null,
//     source: "shopify_orders",
//   }
// }

// async function fetchProductSalesFromOrders(
//   shop,
//   accessToken,
//   startDate,
//   endDate,
// ) {
//   const orders = await fetchOrdersInRange(shop, accessToken, startDate, endDate)
//   const byProductId = {}

//   for (const order of orders) {
//     if (["voided", "refunded"].includes(order.financial_status)) continue
//     for (const item of order.line_items || []) {
//       const productId = String(item.product_id)
//       if (!productId) continue
//       if (!byProductId[productId]) {
//         byProductId[productId] = {
//           shopifyProductId: productId,
//           title: item.title,
//           revenue: 0,
//           orders: 0,
//           source: "shopify_orders",
//         }
//       }
//       byProductId[productId].orders += 1
//       byProductId[productId].revenue +=
//         toNumber(item.price) * toNumber(item.quantity)
//     }
//   }

//   for (const entry of Object.values(byProductId)) {
//     entry.revenue = Math.round(entry.revenue * 100) / 100
//   }

//   return byProductId
// }

// /**
//  * Register a webhook with Shopify.
//  */
// async function registerWebhook(shop, accessToken, topic) {
//   const address = `${process.env.APP_URL}/api/webhooks/${topic.replace("/", "-")}`
//   try {
//     await axios.post(
//       `https://${shop}/admin/api/2024-01/webhooks.json`,
//       { webhook: { topic, address, format: "json" } },
//       { headers: { "X-Shopify-Access-Token": accessToken } },
//     )
//     logger.info(`Webhook registered: ${topic} → ${address}`)
//   } catch (err) {
//     // Ignore duplicate webhook errors
//     if (
//       err.response?.data?.errors?.address?.[0] !==
//       "for this topic has already been taken"
//     ) {
//       logger.warn(
//         `Webhook registration failed for ${topic}:`,
//         err.response?.data,
//       )
//     }
//   }
// }

// export {
//   buildAuthUrl,
//   exchangeCodeForToken,
//   verifyHmac,
//   verifyWebhookHmac,
//   fetchAllProducts,
//   fetchProduct,
//   fetchProductCollections,
//   fetchProductMetafields,
//   parseFaqsFromMetafields,
//   parseReviewsFromMetafields,
//   mapProductMetafields,
//   upsertProductFaqMetafield,
//   updateProduct,
//   fetchShopInfo,
//   registerWebhook,
//   graphqlQuery,
//   shopifyqlQuery,
//   fetchStoreMetricsForRange,
//   fetchStoreMetricsComparison,
//   fetchProductSalesMetrics,
//   fetchProductSessionMetrics,
//   fetchProductSalesFromOrders,
//   fetchMarkets,
//   RECOMIND_METAFIELD_NAMESPACE,
// }

import axios from "axios"
import crypto from "crypto"
import logger from "../config/logger.js"
import shopifyHttp from "../utils/shopify-http.js"

const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || "2026-07"
const RECOMIND_METAFIELD_NAMESPACE = "RecoMind"

/**
 * Build the Shopify OAuth authorisation URL.
 * Redirect the merchant to this URL to begin OAuth.
 */
function buildAuthUrl(shop, state) {
  const { SHOPIFY_API_KEY, SHOPIFY_SCOPES, SHOPIFY_REDIRECT_URI } = process.env
  const params = new URLSearchParams({
    client_id: SHOPIFY_API_KEY,
    scope: SHOPIFY_SCOPES,
    redirect_uri: SHOPIFY_REDIRECT_URI,
    state,
    "grant_options[]": "per-user",
  })
  return `https://${shop}/admin/oauth/authorize?${params.toString()}`
}

/**
 * Exchange the OAuth code for a permanent access token.
 */
async function exchangeCodeForToken(shop, code) {
  const { SHOPIFY_API_KEY, SHOPIFY_API_SECRET } = process.env
  const res = await shopifyHttp.post(
    `https://${shop}/admin/oauth/access_token`,
    {
      client_id: SHOPIFY_API_KEY,
      client_secret: SHOPIFY_API_SECRET,
      code,
    },
  )
  return res.data.access_token
}

/**
 * Verify the HMAC signature from Shopify on the OAuth callback.
 */
function verifyHmac(query) {
  const { hmac, ...rest } = query
  const message = Object.keys(rest)
    .sort()
    .map((k) => `${k}=${Array.isArray(rest[k]) ? rest[k].join(",") : rest[k]}`)
    .join("&")
  const expected = crypto
    .createHmac("sha256", process.env.SHOPIFY_API_SECRET)
    .update(message)
    .digest("hex")
  return crypto.timingSafeEqual(
    Buffer.from(expected, "hex"),
    Buffer.from(hmac, "hex"),
  )
}

/**
 * Verify webhook HMAC from Shopify.
 */
function verifyWebhookHmac(rawBody, hmacHeader) {
  const expected = crypto
    .createHmac("sha256", process.env.SHOPIFY_WEBHOOK_SECRET)
    .update(rawBody)
    .digest("base64")
  return crypto.timingSafeEqual(
    Buffer.from(expected, "base64"),
    Buffer.from(hmacHeader, "base64"),
  )
}

/**
 * Fetch collections for a product.
 */
async function fetchProductCollections(shop, accessToken, shopifyProductId) {
  try {
    const query = `
      query ProductCollections($id: ID!) {
        product(id: $id) {
          collections(first: 20) {
            edges {
              node {
                id
                title
                handle
              }
            }
          }
        }
      }
    `
    const data = await graphqlQuery(shop, accessToken, query, {
      id: `gid://shopify/Product/${shopifyProductId}`,
    })

    const edges = data?.product?.collections?.edges || []
    return edges.map(({ node }) => ({
      shopifyCollectionId: node.id.split("/").pop(),
      title: node.title,
      handle: node.handle,
    }))
  } catch (err) {
    logger.warn(
      `Could not fetch collections for product ${shopifyProductId}:`,
      err.message,
    )
    return []
  }
}

/**
 * Parse review data from product metafields (Judge.me, Loox, Yotpo, etc.).
 */
function parseReviewsFromMetafields(metafields) {
  const reviewKeys = [
    "reviews",
    "review",
    "product_reviews",
    "judgeme_reviews",
    "loox_reviews",
    "stamped_reviews",
    "yotpo_reviews",
  ]

  const reviews = []
  for (const mf of metafields || []) {
    const key = (mf.key || "").toLowerCase()
    if (
      !reviewKeys.some(
        (k) => key.includes(k.replace("_reviews", "")) || key === k,
      )
    ) {
      if (!key.includes("review")) continue
    }

    try {
      const parsed = JSON.parse(mf.value)
      if (Array.isArray(parsed)) {
        parsed.forEach((r) => {
          const body = r.body || r.content || r.review || r.text
          if (body) {
            reviews.push({
              rating: Number(r.rating || r.score || r.stars) || null,
              body: String(body).slice(0, 500),
              author: r.author || r.name || r.reviewer || "Customer",
              date:
                r.date || r.created_at
                  ? new Date(r.date || r.created_at)
                  : null,
              source: mf.namespace || "metafield",
            })
          }
        })
      }
    } catch {
      if (typeof mf.value === "string" && mf.value.length > 20) {
        reviews.push({
          rating: null,
          body: mf.value.slice(0, 500),
          author: "Customer",
          source: mf.namespace || "metafield",
        })
      }
    }
  }
  return reviews.slice(0, 50)
}

/**
 * Map metafields to a simplified store-friendly format.
 */
function mapProductMetafields(metafields) {
  return (metafields || [])
    .filter((m) => m.key !== "faqs" && m.key !== "faq")
    .map((m) => ({
      namespace: m.namespace,
      key: m.key,
      value: String(m.value || "").slice(0, 2000),
      type: m.type,
    }))
    .slice(0, 30)
}

/**
 * Fetch paginated products from Shopify.
 * Returns all products across all pages.
 */
async function fetchAllProducts(shop, accessToken) {
  let products = []
  let url = `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/products.json?limit=250&fields=id,title,body_html,tags,variants,images,product_type,vendor,handle,status,created_at,updated_at`

  while (url) {
    const res = await shopifyHttp.get(url, {
      headers: { "X-Shopify-Access-Token": accessToken },
    })
    products = products.concat(res.data.products)

    // Handle link header pagination
    const linkHeader = res.headers["link"]
    url = null
    if (linkHeader) {
      const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/)
      if (nextMatch) url = nextMatch[1]
    }
  }

  logger.info(`Fetched ${products.length} products from ${shop}`)
  return products
}

/**
 * Fetch a single product from Shopify by its ID.
 */
async function fetchProduct(shop, accessToken, shopifyProductId) {
  const res = await shopifyHttp.get(
    `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/products/${shopifyProductId}.json`,
    { headers: { "X-Shopify-Access-Token": accessToken } },
  )
  return res.data.product
}

/**
 * Fetch product metafields (for FAQ detection).
 */
async function fetchProductMetafields(shop, accessToken, shopifyProductId) {
  try {
    const res = await shopifyHttp.get(
      `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/products/${shopifyProductId}/metafields.json`,
      { headers: { "X-Shopify-Access-Token": accessToken } },
    )
    return res.data.metafields || []
  } catch (err) {
    logger.warn(
      `Could not fetch metafields for product ${shopifyProductId}:`,
      err.message,
    )
    return []
  }
}

/**
 * Parse FAQ data from product metafields.
 * Supports RecoMind namespace and common FAQ app formats.
 */
function parseFaqsFromMetafields(metafields) {
  const faqMetafields = (metafields || []).filter(
    (m) =>
      m.key === "faqs" ||
      m.key === "faq" ||
      m.key === "product_faq" ||
      (m.namespace === "faq" && m.type?.includes("json")),
  )

  for (const mf of faqMetafields) {
    try {
      const parsed = JSON.parse(mf.value)
      if (Array.isArray(parsed)) {
        return parsed
          .map((item) => ({
            question: item.question || item.q || item.title,
            answer: item.answer || item.a || item.content,
            source: "metafield",
            metafieldId: mf.id,
          }))
          .filter((f) => f.question && f.answer)
      }
    } catch {
      // not JSON — skip
    }
  }
  return []
}

/**
 * Create or update RecoMind FAQ metafield on a product.
 */
async function upsertProductFaqMetafield(
  shop,
  accessToken,
  shopifyProductId,
  faqs,
) {
  const metafields = await fetchProductMetafields(
    shop,
    accessToken,
    shopifyProductId,
  )
  const existing = metafields.find(
    (m) => m.namespace === RECOMIND_METAFIELD_NAMESPACE && m.key === "faqs",
  )

  const payload = {
    metafield: {
      namespace: RECOMIND_METAFIELD_NAMESPACE,
      key: "faqs",
      value: JSON.stringify(faqs),
      type: "json",
    },
  }

  if (existing) {
    const res = await shopifyHttp.put(
      `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/metafields/${existing.id}.json`,
      {
        metafield: {
          id: existing.id,
          value: JSON.stringify(faqs),
          type: "json",
        },
      },
      { headers: { "X-Shopify-Access-Token": accessToken } },
    )
    return res.data.metafield
  }

  const res = await shopifyHttp.post(
    `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/products/${shopifyProductId}/metafields.json`,
    payload,
    { headers: { "X-Shopify-Access-Token": accessToken } },
  )
  return res.data.metafield
}

/**
 * Update a product's title, body_html, and tags in Shopify.
 */
async function updateProduct(shop, accessToken, shopifyProductId, payload) {
  const res = await shopifyHttp.put(
    `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/products/${shopifyProductId}.json`,
    { product: payload },
    {
      headers: {
        "X-Shopify-Access-Token": accessToken,
        "Content-Type": "application/json",
      },
    },
  )
  return res.data.product
}

/**
 * Get basic shop info (name, email, owner, currency, etc.)
 */
async function fetchShopInfo(shop, accessToken) {
  const res = await shopifyHttp.get(
    `https://${shop}/admin/api/2024-01/shop.json`,
    {
      headers: { "X-Shopify-Access-Token": accessToken },
    },
  )
  return res.data.shop
}

async function fetchMarkets(shop, accessToken) {
  const query = `
    query {
      markets(first: 50) {
        edges {
          node {
            id
            name
            enabled
            primary
            regions(first: 50) {
              edges {
                node {
                  ... on MarketRegionCountry {
                    name
                    code
                  }
                }
              }
            }
          }
        }
      }
    }
  `

  const res = await shopifyHttp.post(
    `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
    { query },
    {
      headers: {
        "X-Shopify-Access-Token": accessToken,
        "Content-Type": "application/json",
      },
    },
  )

  const edges = res.data?.data?.markets?.edges ?? []
  return edges.map(({ node }) => ({
    marketId: node.id,
    name: node.name,
    enabled: node.enabled,
    primary: node.primary,
    regions: (node.regions?.edges ?? []).map(({ node: r }) => ({
      code: r.code,
      name: r.name,
    })),
  }))
}

/**
 * Execute a GraphQL Admin API query.
 */
async function graphqlQuery(shop, accessToken, query, variables = {}) {
  try {
    const res = await shopifyHttp.post(
      `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
      { query, variables },
      {
        headers: {
          "X-Shopify-Access-Token": accessToken,
          "Content-Type": "application/json",
        },
      },
    )

    if (res.data.errors?.length) {
      throw new Error(res.data.errors.map((e) => e.message).join(", "))
    }

    return res.data.data
  } catch (err) {
    // Surface Shopify API HTTP errors with clearer messages and status codes
    const status = err?.response?.status
    if (status === 403) {
      const e = new Error(
        "Shopify analytics access forbidden: missing read_reports scope or insufficient permissions",
      )
      e.statusCode = 403
      throw e
    }
    if (status === 401) {
      const e = new Error("Shopify access token invalid or expired (401)")
      e.statusCode = 401
      throw e
    }

    // Pass through other errors
    throw err
  }
}

/**
 * Parse ShopifyQL tableData rows into plain objects.
 */
function parseShopifyqlTable(tableData) {
  if (!tableData?.rows?.length) return []
  const columns = (tableData.columns || []).map((c) => c.name)
  return tableData.rows.map((row) => {
    if (row && typeof row === "object" && !Array.isArray(row)) return row
    const obj = {}
    columns.forEach((col, i) => {
      obj[col] = row[col] ?? row[i]
    })
    return obj
  })
}

/**
 * Run a ShopifyQL query via the GraphQL Admin API (requires read_reports scope).
 */
async function shopifyqlQuery(shop, accessToken, shopifyql) {
  const query = `
    query RunShopifyql($query: String!) {
      shopifyqlQuery(query: $query) {
        tableData {
          columns { name dataType displayName }
          rows
        }
        parseErrors
      }
    }
  `

  const data = await graphqlQuery(shop, accessToken, query, {
    query: shopifyql,
  })
  const result = data?.shopifyqlQuery

  if (!result) {
    throw new Error("ShopifyQL query returned no data")
  }

  if (result.parseErrors?.length) {
    throw new Error(result.parseErrors.join(", "))
  }

  return parseShopifyqlTable(result.tableData)
}

function toNumber(value) {
  const n = Number(String(value ?? "").replace(/[^0-9.-]/g, ""))
  return Number.isFinite(n) ? n : 0
}

function formatShopifyqlDate(date) {
  return date.toISOString().slice(0, 10)
}

/**
 * Store-wide commerce metrics for a date range from ShopifyQL.
 */
async function fetchStoreMetricsForRange(
  shop,
  accessToken,
  startDate,
  endDate,
) {
  const since = formatShopifyqlDate(startDate)
  const until = formatShopifyqlDate(endDate)
  const query = `FROM sales, sessions SHOW total_sales, orders, sessions, product_views SINCE ${since} UNTIL ${until}`

  try {
    const rows = await shopifyqlQuery(shop, accessToken, query)
    const row = rows[0] || {}
    const orders = toNumber(row.orders)
    const sessions = toNumber(row.sessions)
    const views = toNumber(row.product_views)
    const revenue = toNumber(row.total_sales)

    return {
      revenue,
      orders,
      sessions,
      views,
      traffic: sessions || views,
      conversionRate:
        sessions > 0 ? Math.round((orders / sessions) * 10000) / 100 : null,
      source: "shopify",
    }
  } catch (err) {
    logger.warn(`ShopifyQL store metrics failed for ${shop}:`, err.message)
    return fetchStoreMetricsFromOrders(shop, accessToken, startDate, endDate)
  }
}

/**
 * Compare current period vs previous period using ShopifyQL COMPARE.
 */
async function fetchStoreMetricsComparison(shop, accessToken, days = 30) {
  const query = `FROM sales, sessions SHOW total_sales, orders, sessions, product_views SINCE -${days}d COMPARE TO previous_period`

  try {
    const rows = await shopifyqlQuery(shop, accessToken, query)
    const current =
      rows.find((r) => r.period === "current_period") || rows[0] || {}
    const previous =
      rows.find((r) => r.period === "previous_period") || rows[1] || {}

    const mapRow = (row) => {
      const orders = toNumber(row.orders)
      const sessions = toNumber(row.sessions)
      const views = toNumber(row.product_views)
      return {
        revenue: toNumber(row.total_sales),
        orders,
        sessions,
        views,
        traffic: sessions || views,
        conversionRate:
          sessions > 0 ? Math.round((orders / sessions) * 10000) / 100 : null,
        source: "shopify",
      }
    }

    return {
      current: mapRow(current),
      previous: mapRow(previous),
      source: "shopify",
    }
  } catch (err) {
    logger.warn(`ShopifyQL comparison failed for ${shop}:`, err.message)
    const end = new Date()
    const start = new Date(end)
    start.setDate(start.getDate() - days)
    const prevEnd = new Date(start)
    prevEnd.setDate(prevEnd.getDate() - 1)
    const prevStart = new Date(prevEnd)
    prevStart.setDate(prevStart.getDate() - days)

    const [current, previous] = await Promise.all([
      fetchStoreMetricsFromOrders(shop, accessToken, start, end),
      fetchStoreMetricsFromOrders(shop, accessToken, prevStart, prevEnd),
    ])

    return { current, previous, source: "shopify_orders" }
  }
}

/**
 * Per-product sales metrics grouped by product title (ShopifyQL).
 */
async function fetchProductSalesMetrics(shop, accessToken, startDate, endDate) {
  const since = formatShopifyqlDate(startDate)
  const until = formatShopifyqlDate(endDate)
  const query = `FROM sales SHOW total_sales, orders GROUP BY product_title SINCE ${since} UNTIL ${until} ORDER BY total_sales DESC LIMIT 250`

  try {
    const rows = await shopifyqlQuery(shop, accessToken, query)
    const byTitle = {}
    for (const row of rows) {
      const title = row.product_title
      if (!title) continue
      byTitle[title.toLowerCase()] = {
        title,
        revenue: toNumber(row.total_sales),
        orders: toNumber(row.orders),
        source: "shopify",
      }
    }
    return byTitle
  } catch (err) {
    logger.warn(`ShopifyQL product sales failed for ${shop}:`, err.message)
    return fetchProductSalesFromOrders(shop, accessToken, startDate, endDate)
  }
}

/**
 * Per-product session funnel metrics (traffic, views, conversions).
 */
async function fetchProductSessionMetrics(
  shop,
  accessToken,
  startDate,
  endDate,
) {
  const since = formatShopifyqlDate(startDate)
  const until = formatShopifyqlDate(endDate)
  const query = `FROM sessions SHOW sessions, product_views, add_to_carts, checkouts, orders GROUP BY product_title SINCE ${since} UNTIL ${until} ORDER BY sessions DESC LIMIT 250`

  try {
    const rows = await shopifyqlQuery(shop, accessToken, query)
    const byTitle = {}
    for (const row of rows) {
      const title = row.product_title
      if (!title) continue
      const sessions = toNumber(row.sessions)
      const orders = toNumber(row.orders)
      byTitle[title.toLowerCase()] = {
        title,
        sessions,
        views: toNumber(row.product_views),
        addToCarts: toNumber(row.add_to_carts),
        checkouts: toNumber(row.checkouts),
        orders,
        traffic: sessions || toNumber(row.product_views),
        conversionRate:
          sessions > 0 ? Math.round((orders / sessions) * 10000) / 100 : null,
        source: "shopify",
      }
    }
    return byTitle
  } catch (err) {
    logger.warn(`ShopifyQL product sessions failed for ${shop}:`, err.message)
    return {}
  }
}

/**
 * Aggregate order line items by Shopify product ID (read_orders fallback).
 */
async function fetchOrdersInRange(shop, accessToken, startDate, endDate) {
  let url = `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/orders.json?status=any&limit=250&fields=id,created_at,line_items,financial_status`
  if (startDate) url += `&created_at_min=${startDate.toISOString()}`
  if (endDate) url += `&created_at_max=${endDate.toISOString()}`

  const orders = []
  try {
    while (url) {
      const res = await shopifyHttp.get(url, {
        headers: { "X-Shopify-Access-Token": accessToken },
      })
      orders.push(...(res.data.orders || []))

      const linkHeader = res.headers.link
      url = null
      if (linkHeader) {
        const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/)
        if (nextMatch) url = nextMatch[1]
      }
    }
  } catch (err) {
    const status = err?.response?.status
    // Provide clearer error messages for common Shopify API issues
    if (status === 403) {
      const e = new Error(
        "Shopify API access forbidden: access token lacks required scopes (e.g., read_orders) or permissions",
      )
      e.statusCode = 403
      e.response = err.response
      throw e
    }
    if (status === 401) {
      const e = new Error(
        "Shopify API unauthorized: access token invalid or expired",
      )
      e.statusCode = 401
      e.response = err.response
      throw e
    }

    throw err
  }

  return orders
}

async function fetchStoreMetricsFromOrders(
  shop,
  accessToken,
  startDate,
  endDate,
) {
  const orders = await fetchOrdersInRange(shop, accessToken, startDate, endDate)
  let revenue = 0
  let orderCount = 0

  for (const order of orders) {
    if (["voided", "refunded"].includes(order.financial_status)) continue
    orderCount += 1
    for (const item of order.line_items || []) {
      revenue += toNumber(item.price) * toNumber(item.quantity)
    }
  }

  return {
    revenue: Math.round(revenue * 100) / 100,
    orders: orderCount,
    sessions: null,
    views: null,
    traffic: null,
    conversionRate: null,
    source: "shopify_orders",
  }
}

async function fetchProductSalesFromOrders(
  shop,
  accessToken,
  startDate,
  endDate,
) {
  const orders = await fetchOrdersInRange(shop, accessToken, startDate, endDate)
  const byProductId = {}

  for (const order of orders) {
    if (["voided", "refunded"].includes(order.financial_status)) continue
    for (const item of order.line_items || []) {
      const productId = String(item.product_id)
      if (!productId) continue
      if (!byProductId[productId]) {
        byProductId[productId] = {
          shopifyProductId: productId,
          title: item.title,
          revenue: 0,
          orders: 0,
          source: "shopify_orders",
        }
      }
      byProductId[productId].orders += 1
      byProductId[productId].revenue +=
        toNumber(item.price) * toNumber(item.quantity)
    }
  }

  for (const entry of Object.values(byProductId)) {
    entry.revenue = Math.round(entry.revenue * 100) / 100
  }

  return byProductId
}

/**
 * Search the merchant's live Shopify catalog by title, paginated.
 * Used by the product-sync picker — does NOT touch our DB, this is a
 * live read against Shopify so the picker always reflects what's
 * actually in the store right now (including products we've never synced).
 */
async function searchShopifyProducts(
  shop,
  accessToken,
  { query = "", collectionId = "", cursor = null, limit = 20 } = {},
) {
  const gqlQuery = `
    query SearchProducts($first: Int!, $after: String, $query: String) {
      products(first: $first, after: $after, query: $query, sortKey: TITLE) {
        edges {
          cursor
          node {
            id
            title
            handle
            status
            featuredImage {
              url
              altText
            }
            totalVariants
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  `

  // Shopify search syntax: bare terms match title/vendor/tag etc.
  // Wrap in wildcard so partial words match too (e.g. "ring" matches "Diamond Ring").
  const searchTerms = []
  if (query?.trim()) searchTerms.push(`title:*${query.trim()}*`)
  if (collectionId) searchTerms.push(`collection_id:${collectionId}`)
  const searchQuery = searchTerms.length ? searchTerms.join(" ") : null

  const data = await graphqlQuery(shop, accessToken, gqlQuery, {
    first: Math.min(Math.max(parseInt(limit, 10) || 20, 1), 50),
    after: cursor || null,
    query: searchQuery,
  })

  const edges = data?.products?.edges || []
  return {
    products: edges.map((e) => ({
      shopifyProductId: e.node.id.split("/").pop(), // gid://shopify/Product/123 -> "123"
      gid: e.node.id,
      title: e.node.title,
      handle: e.node.handle,
      status: e.node.status,
      image: e.node.featuredImage?.url || null,
      variantCount: e.node.totalVariants,
    })),
    pageInfo: data?.products?.pageInfo || {
      hasNextPage: false,
      endCursor: null,
    },
  }
}

/** Search the merchant's Shopify collections for the sync picker. */
async function searchShopifyCollections(shop, accessToken, query = "") {
  const gqlQuery = `
    query SearchCollections($first: Int!, $query: String) {
      collections(first: $first, query: $query, sortKey: TITLE) {
        edges {
          node { id title handle productsCount { count } }
        }
      }
    }
  `
  const data = await graphqlQuery(shop, accessToken, gqlQuery, {
    first: 50,
    query: query?.trim() ? `title:*${query.trim()}*` : null,
  })
  return (data?.collections?.edges || []).map(({ node }) => ({
    shopifyCollectionId: node.id.split("/").pop(),
    title: node.title,
    handle: node.handle,
    productCount: node.productsCount?.count || 0,
  }))
}

/**
 * Fetch multiple products by their numeric IDs in one call (used when the
 * merchant confirms their selection in the sync picker).
 */
async function fetchProductsByIds(shop, accessToken, shopifyProductIds = []) {
  const ids = shopifyProductIds.map((id) => `gid://shopify/Product/${id}`)
  const gqlQuery = `
    query ProductsByIds($ids: [ID!]!) {
      nodes(ids: $ids) {
        ... on Product {
          legacyResourceId
        }
      }
    }
  `
  // We still fetch full REST product payloads (body_html, variants, images)
  // via the existing fetchProduct() per id, since that's what enrichProductFromShopify
  // in productsync.service.js expects. This GraphQL call is just a fast
  // existence/permission check before we pay for N REST calls.
  await graphqlQuery(shop, accessToken, gqlQuery, { ids })
  return shopifyProductIds
}

/**
 * Register a webhook with Shopify.
 */
async function registerWebhook(shop, accessToken, topic) {
  const address = `${process.env.APP_URL}/api/webhooks/${topic.replace("/", "-")}`
  try {
    const res = await shopifyHttp.post(
      `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/webhooks.json`,
      { webhook: { topic, address, format: "json" } },
      { headers: { "X-Shopify-Access-Token": accessToken } },
    )
    logger.info(
      `Webhook registered: ${topic} → ${address} (status=${res.status})`,
    )
    logger.info(
      `Webhook registration response body: ${JSON.stringify(res.data)}`,
    )
  } catch (err) {
    // Ignore duplicate webhook errors
    if (
      err.response?.data?.errors?.address?.[0] !==
      "for this topic has already been taken"
    ) {
      logger.warn(`Webhook registration failed for ${topic}: ${err.message}`)
      if (err.response) {
        logger.warn(`Shopify response: ${JSON.stringify(err.response.data)}`)
      }
    }
  }
}

export {
  buildAuthUrl,
  exchangeCodeForToken,
  verifyHmac,
  verifyWebhookHmac,
  fetchAllProducts,
  fetchProduct,
  searchShopifyProducts,
  searchShopifyCollections,
  fetchProductsByIds,
  fetchProductCollections,
  fetchProductMetafields,
  parseFaqsFromMetafields,
  parseReviewsFromMetafields,
  mapProductMetafields,
  upsertProductFaqMetafield,
  updateProduct,
  fetchShopInfo,
  registerWebhook,
  graphqlQuery,
  shopifyqlQuery,
  fetchStoreMetricsForRange,
  fetchStoreMetricsComparison,
  fetchProductSalesMetrics,
  fetchProductSessionMetrics,
  fetchProductSalesFromOrders,
  fetchMarkets,
  RECOMIND_METAFIELD_NAMESPACE,
}
