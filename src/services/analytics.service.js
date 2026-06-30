//

import axios from "axios"
import Product from "../models/product.model.js"
import ProductAnalysis from "../models/product-analysis.mode.js"
import ProductPrompt from "../models/product-prompt.model.js"

const SHOPIFY_API_VERSION = "2024-01"
const RATE_LIMIT_MAX_RETRIES = 3

export async function findFirstAppliedAnalysis(storeId, productId) {
  const filter = { storeId, appliedToShopify: true }
  if (productId) filter.productId = productId

  const analysis = await ProductAnalysis.findOne(filter)
    .sort({ appliedAt: 1 })
    .select("appliedAt")
    .lean()

  return analysis?.appliedAt ?? null
}

export async function getProductById(productId, storeId) {
  return Product.findOne({ _id: productId, storeId })
    .select("shopifyProductId")
    .lean()
}

export async function findProductPromptsForStore(storeId, productId) {
  const filter = { storeId }
  if (productId) filter.productId = productId

  return ProductPrompt.find(filter, { scoreHistory: 1 }).lean()
}

function buildOrdersUrl(shop, startDate, endDate, includeLineItems = false) {
  const fields = includeLineItems
    ? "id,total_price_set,line_items,created_at"
    : "id,total_price_set,created_at"

  const params = new URLSearchParams({
    status: "any",
    financial_status: "paid",
    limit: "250",
    fields,
    created_at_min: new Date(startDate).toISOString(),
    created_at_max: new Date(endDate).toISOString(),
  })

  return `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/orders.json?${params.toString()}`
}

function parseLinkHeader(linkHeader) {
  if (!linkHeader || typeof linkHeader !== "string") return null
  const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/)
  return nextMatch ? nextMatch[1] : null
}

async function fetchShopifyOrdersPage(url, headers, retries = 0) {
  try {
    return await axios.get(url, { headers })
  } catch (err) {
    const status = err?.response?.status
    if (status === 429 && retries < RATE_LIMIT_MAX_RETRIES) {
      const retryAfterHeader = err.response.headers["retry-after"]
      const retryAfterSeconds = Math.max(
        1,
        Number.isFinite(parseFloat(retryAfterHeader))
          ? Math.ceil(parseFloat(retryAfterHeader))
          : 1,
      )
      await new Promise((resolve) =>
        setTimeout(resolve, retryAfterSeconds * 1000),
      )
      return fetchShopifyOrdersPage(url, headers, retries + 1)
    }

    if (status === 429) {
      const error = new Error(
        "Shopify rate limit exceeded after 3 retries. Try again in a few minutes.",
      )
      error.statusCode = 429
      throw error
    }

    throw err
  }
}

export async function fetchOrdersInRange(
  shop,
  accessToken,
  startDate,
  endDate,
  { includeLineItems = false } = {},
) {
  const headers = { "X-Shopify-Access-Token": accessToken }
  let url = buildOrdersUrl(shop, startDate, endDate, includeLineItems)
  const orders = []

  while (url) {
    const res = await fetchShopifyOrdersPage(url, headers)
    orders.push(...(res.data.orders || []))
    url = parseLinkHeader(res.headers.link)
  }

  return orders
}

export function sumRevenue(orders) {
  return orders.reduce((total, order) => {
    const amount = parseFloat(order?.total_price_set?.shop_money?.amount || 0)
    return total + (Number.isFinite(amount) ? amount : 0)
  }, 0)
}

export function sumRevenueForProduct(orders, shopifyProductId) {
  return orders.reduce((total, order) => {
    const matchedItems = (order.line_items || []).filter(
      (item) => String(item.product_id) === String(shopifyProductId),
    )

    const productTotal = matchedItems.reduce((sum, item) => {
      const price = parseFloat(item.price || 0)
      const quantity = Number.isFinite(item.quantity) ? item.quantity : 0
      return sum + price * quantity
    }, 0)

    return total + productTotal
  }, 0)
}

export function countOrdersContainingProduct(orders, shopifyProductId) {
  return orders.reduce((count, order) => {
    const hasProduct = (order.line_items || []).some(
      (item) => String(item.product_id) === String(shopifyProductId),
    )
    return count + (hasProduct ? 1 : 0)
  }, 0)
}