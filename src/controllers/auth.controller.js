import Store from "../models/store.model.js"
import AuditLog from "../models/auditlog.model.js"
import * as shopifyService from "../services/shopify.service.js"
import * as productSyncService from "../services/productsync.service.js"
import { getPlanConfig, getAllPlans, getAllAddons } from "../config/plans.js"
import { signToken } from "../middleware/auth.js"
import logger from "../config/logger.js"

/**
 * POST /api/stores
 *
 * Called by the Shopify app's afterAuth hook (your Shopify app template server).
 * Receives session data, saves store to MongoDB, returns JWT.
 *
 * In your Shopify app (afterAuth hook):
 *
 *   hooks: {
 *     afterAuth: async ({ session }) => {
 *       await shopify.registerWebhooks({ session });
 *
 *       const res = await fetch("https://your-backend.onrender.com/api/stores", {
 *         method: "POST",
 *         headers: { "Content-Type": "application/json" },
 *         body: JSON.stringify({
 *           shop: session.shop,
 *           accessToken: session.accessToken,
 *           scope: session.scope,
 *         }),
 *       });
 *
 *       const data = await res.json();
 *       // data.token is your JWT — store it in the session/cookie
 *       // so your frontend can use it for subsequent API calls
 *     },
 *   },
 */
async function registerStore(req, res, next) {
  try {
    let { shop, accessToken, scope } = req.body

    if (!shop || !accessToken) {
      return res.status(400).json({
        success: false,
        error: "shop and accessToken are required",
      })
    }

    // Normalize shop domain
    shop = shop.toLowerCase().trim()

    // Fetch enriched shop info from Shopify
    const shopInfo = await shopifyService.fetchShopInfo(shop, accessToken)

    // Upsert our Store record
    let store = await Store.findOne({ shopDomain: shop })
    const isNew = !store

    if (!store) {
      store = new Store({ shopDomain: shop, plan: "starter" })
    }

    store.setAccessToken(accessToken)
    store.scope = scope
    store.shopName = shopInfo.name
    store.shopEmail = shopInfo.email
    store.shopOwner = shopInfo.shop_owner
    store.currency = shopInfo.currency
    store.timezone = shopInfo.iana_timezone
    store.isActive = true
    store.uninstalledAt = undefined

    await store.save()
    logger.info(`Store ${isNew ? "created" : "updated"}: ${shop}`)

    // Register webhooks
    const topics = [
      "products/create",
      "products/update",
      "products/delete",
      "app/uninstalled",
    ]
    await Promise.allSettled(
      topics.map((topic) =>
        shopifyService.registerWebhook(shop, accessToken, topic),
      ),
    )

    // Kick off product sync (non-blocking)
    productSyncService.syncAllProducts(store._id).catch((err) => {
      logger.error("Initial product sync failed")
      logger.error(err)
      logger.error(err?.stack)
    })

    // Audit log
    await AuditLog.create({
      storeId: store._id,
      action: "STORE_INSTALLED",
      entityType: "store",
      entityId: store._id,
      metadata: { isNew, shopName: shopInfo.name },
      performedBy: "afterAuth",
    })

    // Issue JWT
    const token = signToken(store._id, shop, store.plan)

    res.json({
      success: true,
      token,
      store: {
        id: store._id,
        shopDomain: store.shopDomain,
        shopName: store.shopName,
        plan: store.plan,
      },
    })
  } catch (err) {
    next(err)
  }
}

/**
 * GET /api/auth/me
 * Returns the currently authenticated store's details.
 * Called by the frontend after it has a valid JWT.
 */
async function getMe(req, res) {
  const store = req.store

  // Reset monthly quota if needed
  store.resetMonthlyQuotaIfNeeded()

  res.json({
    success: true,
    data: {
      id: store._id,
      shopDomain: store.shopDomain,
      shopName: store.shopName,
      shopEmail: store.shopEmail,
      shopOwner: store.shopOwner,
      currency: store.currency,
      timezone: store.timezone,
      plan: store.plan,
      planExpiresAt: store.planExpiresAt,
      planConfig: getPlanConfig(store.plan),
      addons: store.addons || {},
      promptLimits: store.getPromptLimits(),
      faqStrategy: store.faqStrategy,
      totalProductsSynced: store.totalProductsSynced,
      lastSyncedAt: store.lastSyncedAt,
      installedAt: store.installedAt,
      tokenQuota: {
        monthly: store.monthlyTokenQuota,
        used: store.tokensUsedThisMonth,
        remaining: store.getRemainingTokens(),
        resetDate: store.tokenQuotaResetDate,
      },
      lifetime: {
        tokensUsed: store.lifetimeTokensUsed,
      },
    },
  })
}

async function getStoreToken(req, res) {
  try {
    let shop = req.shop

    // Normalize shop domain
    shop = shop.toLowerCase().trim()

    const store = await Store.findOne({
      shopDomain: shop,
      isActive: true,
    })

    if (!store) {
      return res.status(404).json({
        success: false,
        error: "Store not found. Please reinstall the app.",
      })
    }

    const token = signToken(store._id, shop, store.plan)

    return res.json({
      success: true,
      token,
      store: {
        id: store._id,
        shopDomain: store.shopDomain,
        shopName: store.shopName,
        plan: store.plan,
      },
    })
  } catch (err) {
    console.error("Error in getStoreToken:", err)
    return res.status(500).json({
      success: false,
      error: "Internal server error",
    })
  }
}

/**
 * PATCH /api/stores/me/settings
 * Update store preferences (e.g. FAQ strategy).
 */
async function updateStoreSettings(req, res, next) {
  try {
    const { faqStrategy } = req.body
    const validStrategies = ["auto", "inline", "metafield"]

    if (faqStrategy && !validStrategies.includes(faqStrategy)) {
      return res.status(400).json({
        success: false,
        error: "faqStrategy must be auto, inline, or metafield",
      })
    }

    if (faqStrategy) req.store.faqStrategy = faqStrategy
    await req.store.save()

    res.json({
      success: true,
      data: {
        faqStrategy: req.store.faqStrategy,
        planConfig: getPlanConfig(req.store.plan),
        promptLimits: req.store.getPromptLimits(),
      },
    })
  } catch (err) {
    next(err)
  }
}

/**
 * GET /api/stores/plans
 * Public pricing data for the app pricing page.
 */
async function listPlans(req, res) {
  res.json({
    success: true,
    data: {
      positioning: "Plans based on how many AI searches you want to win.",
      plans: getAllPlans(),
      addons: getAllAddons(),
    },
  })
}

export { registerStore, getMe, getStoreToken, updateStoreSettings, listPlans }
