import mongoose from "mongoose"
import Store from "../models/store.model.js"
import Product from "../models/product.model.js"
import AuditLog from "../models/auditlog.model.js"
import * as shopifyService from "../services/shopify.service.js"
import * as productSyncService from "../services/productsync.service.js"
import * as marketSyncService from "../services/marketsync.service.js"
import { enqueueAnalysis } from "../jobs/analysisqueue.js"
import logger from "../config/logger.js"

function verifyShopifyWebhook(req, res, next) {
  const hmac = req.headers["x-shopify-hmac-sha256"]
  const shop = req.headers["x-shopify-shop-domain"]

  if (!hmac || !shop) {
    return res.status(401).json({ error: "Missing webhook headers" })
  }

  // Use rawBody (Buffer) for HMAC verification - must be the original bytes
  const rawBody =
    typeof req.body === "string"
      ? req.body
      : Buffer.isBuffer(req.body)
        ? req.body.toString()
        : JSON.stringify(req.body)

  if (!shopifyService.verifyWebhookHmac(rawBody, hmac)) {
    logger.warn(`Webhook HMAC failed from ${shop}`)
    return res.status(401).json({ error: "HMAC validation failed" })
  }

  // Normalize shop domain and parse body for use in handlers
  req.shopDomain = shop.toLowerCase().trim()
  req.webhookBody =
    typeof req.body === "string" ? JSON.parse(req.body) : req.body
  next()
}

async function handleProductCreate(req, res) {
  res.sendStatus(200) // Acknowledge immediately
  try {
    const shop = req.shopDomain
    const store = await Store.findOne({ shopDomain: shop })
    if (!store) return

    const data = req.webhookBody
    const product = await productSyncService.syncSingleProduct(
      store._id,
      data.id,
    )

    // Auto-analyse new products
    if (product) {
      await enqueueAnalysis(product._id, store._id)
      logger.info(`Product created webhook processed: ${data.id}`)
    }
  } catch (err) {
    logger.error("Webhook products/create error:", err.message)
  }
}

async function handleProductUpdate(req, res) {
  res.sendStatus(200)
  try {
    const store = await Store.findOne({ shopDomain: req.shopDomain })
    if (!store) return
    const data = req.webhookBody
    await productSyncService.syncSingleProduct(store._id, data.id)
    logger.info(`Product updated webhook processed: ${data.id}`)
  } catch (err) {
    logger.error("Webhook products/update error:", err.message)
  }
}

async function handleProductDelete(req, res) {
  res.sendStatus(200)
  try {
    const store = await Store.findOne({ shopDomain: req.shopDomain })
    if (!store) return
    const data = req.webhookBody
    await Product.findOneAndUpdate(
      { storeId: store._id, shopifyProductId: String(data.id) },
      { status: "archived" },
    )
    logger.info(`Product deleted webhook processed: ${data.id}`)
  } catch (err) {
    logger.error("Webhook products/delete error:", err.message)
  }
}

async function handleAppUninstalled(req, res) {
  res.sendStatus(200)
  try {
    const shop = req.shopDomain

    // Remove the Shopify app session record(s) stored by Prisma session storage.
    await mongoose.connection.collection("Session").deleteMany({ shop })

    await Store.findOneAndUpdate(
      { shopDomain: shop },
      { isActive: false, uninstalledAt: new Date() },
    )
    const store = await Store.findOne({ shopDomain: shop })
    if (store) {
      await AuditLog.create({
        storeId: store._id,
        action: "STORE_UNINSTALLED",
        entityType: "store",
        entityId: store._id,
        performedBy: "system",
      })
    }
    logger.info(`App uninstalled from ${shop}`)
  } catch (err) {
    logger.error("Webhook app/uninstalled error:", err.message)
  }
}

async function handleMarketsUpdate(req, res) {
  res.status(200).send() // ack immediately, per Shopify's webhook requirements

  const shop = req.get("X-Shopify-Shop-Domain")
  const store = await Store.findOne({ shopDomain: shop })
  if (!store) return

  marketSyncService.syncStoreMarkets(store).catch((err) => {
    logger.warn(`Market webhook sync failed for ${shop}: ${err.message}`)
  })
}

async function handleSubscriptionUpdate(req, res) {
  res.sendStatus(200)
  const subscription = req.webhookBody
  const store = await Store.findOne({ shopDomain: req.shopDomain })
  if (!store || subscription.status !== "ACTIVE") return
  const match = String(subscription.name || "").match(
    /([\d,]+) monthly tokens/i,
  )
  const amount = match ? Number(match[1].replace(/,/g, "")) : 0
  if (
    !amount ||
    store.billingSubscriptionId !==
      (subscription.admin_graphql_api_id || store.billingSubscriptionId)
  )
    return
  const reference = `subscription:${subscription.admin_graphql_api_id}:${subscription.updated_at || subscription.created_at || "active"}`
  if (store.lastTokenPurchaseReference === reference) return
  await store.addPurchasedTokens(amount, reference)
  store.billingStatus = "ACTIVE"
  await store.save()
}

export {
  verifyShopifyWebhook,
  handleProductCreate,
  handleProductUpdate,
  handleProductDelete,
  handleAppUninstalled,
  handleMarketsUpdate,
  handleSubscriptionUpdate,
}
