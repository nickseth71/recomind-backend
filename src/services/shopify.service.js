import axios from "axios"
import crypto from "crypto"
import logger from "../config/logger.js"

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
  const res = await axios.post(`https://${shop}/admin/oauth/access_token`, {
    client_id: SHOPIFY_API_KEY,
    client_secret: SHOPIFY_API_SECRET,
    code,
  })
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
    const res = await axios.get(
      `https://${shop}/admin/api/2024-01/products/${shopifyProductId}/collections.json?fields=id,title,handle`,
      { headers: { "X-Shopify-Access-Token": accessToken } },
    )
    return (res.data.collections || []).map((c) => ({
      shopifyCollectionId: String(c.id),
      title: c.title,
      handle: c.handle,
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
  let url = `https://${shop}/admin/api/2024-01/products.json?limit=250&fields=id,title,body_html,tags,variants,images,product_type,vendor,handle,status,created_at,updated_at`

  while (url) {
    const res = await axios.get(url, {
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
  const res = await axios.get(
    `https://${shop}/admin/api/2024-01/products/${shopifyProductId}.json`,
    { headers: { "X-Shopify-Access-Token": accessToken } },
  )
  return res.data.product
}

const RECOMIND_METAFIELD_NAMESPACE = "RecoMind"

/**
 * Fetch product metafields (for FAQ detection).
 */
async function fetchProductMetafields(shop, accessToken, shopifyProductId) {
  try {
    const res = await axios.get(
      `https://${shop}/admin/api/2024-01/products/${shopifyProductId}/metafields.json`,
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
    const res = await axios.put(
      `https://${shop}/admin/api/2024-01/metafields/${existing.id}.json`,
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

  const res = await axios.post(
    `https://${shop}/admin/api/2024-01/products/${shopifyProductId}/metafields.json`,
    payload,
    { headers: { "X-Shopify-Access-Token": accessToken } },
  )
  return res.data.metafield
}

/**
 * Update a product's title, body_html, and tags in Shopify.
 */
async function updateProduct(shop, accessToken, shopifyProductId, payload) {
  const res = await axios.put(
    `https://${shop}/admin/api/2024-01/products/${shopifyProductId}.json`,
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
  const res = await axios.get(`https://${shop}/admin/api/2024-01/shop.json`, {
    headers: { "X-Shopify-Access-Token": accessToken },
  })
  return res.data.shop
}

/**
 * Register a webhook with Shopify.
 */
async function registerWebhook(shop, accessToken, topic) {
  const address = `${process.env.APP_URL}/api/webhooks/${topic.replace("/", "-")}`
  try {
    await axios.post(
      `https://${shop}/admin/api/2024-01/webhooks.json`,
      { webhook: { topic, address, format: "json" } },
      { headers: { "X-Shopify-Access-Token": accessToken } },
    )
    logger.info(`Webhook registered: ${topic} → ${address}`)
  } catch (err) {
    // Ignore duplicate webhook errors
    if (
      err.response?.data?.errors?.address?.[0] !==
      "for this topic has already been taken"
    ) {
      logger.warn(
        `Webhook registration failed for ${topic}:`,
        err.response?.data,
      )
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
  fetchProductCollections,
  fetchProductMetafields,
  parseFaqsFromMetafields,
  parseReviewsFromMetafields,
  mapProductMetafields,
  upsertProductFaqMetafield,
  updateProduct,
  fetchShopInfo,
  registerWebhook,
  RECOMIND_METAFIELD_NAMESPACE,
}
