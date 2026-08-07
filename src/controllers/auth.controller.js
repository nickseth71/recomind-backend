// import Store from "../models/store.model.js"
// import AuditLog from "../models/auditlog.model.js"
// import Product from "../models/product.model.js"
// import ProductPrompt from "../models/product-prompt.model.js"
// import ProductAnalysis from "../models/product-analysis.mode.js"
// import * as shopifyService from "../services/shopify.service.js"
// import * as productSyncService from "../services/productsync.service.js"
// import * as marketSyncService from "../services/marketsync.service.js"
// import { getPlanConfig, getAllPlans, getAllAddons } from "../config/plans.js"
// import { signToken } from "../middleware/auth.js"
// import logger from "../config/logger.js"

// /**
//  * POST /api/stores
//  *
//  * Called by the Shopify app's afterAuth hook (your Shopify app template server).
//  * Receives session data, saves store to MongoDB, returns JWT.
//  *
//  * In your Shopify app (afterAuth hook):
//  *
//  *   hooks: {
//  *     afterAuth: async ({ session }) => {
//  *       await shopify.registerWebhooks({ session });
//  *
//  *       const res = await fetch("https://your-backend.onrender.com/api/stores", {
//  *         method: "POST",
//  *         headers: { "Content-Type": "application/json" },
//  *         body: JSON.stringify({
//  *           shop: session.shop,
//  *           accessToken: session.accessToken,
//  *           scope: session.scope,
//  *         }),
//  *       });
//  *
//  *       const data = await res.json();
//  *       // data.token is your JWT — store it in the session/cookie
//  *       // so your frontend can use it for subsequent API calls
//  *     },
//  *   },
//  */
// async function registerStore(req, res, next) {
//   try {
//     let { shop, accessToken, scope } = req.body

//     if (!shop || !accessToken) {
//       return res.status(400).json({
//         success: false,
//         error: "shop and accessToken are required",
//       })
//     }

//     // Normalize shop domain
//     shop = shop.toLowerCase().trim()

//     // Fetch enriched shop info from Shopify
//     const shopInfo = await shopifyService.fetchShopInfo(shop, accessToken)

//     // Upsert our Store record
//     let store = await Store.findOne({ shopDomain: shop })
//     const isNew = !store

//     if (!store) {
//       store = new Store({ shopDomain: shop, plan: "starter" })
//     }

//     store.setAccessToken(accessToken)
//     store.scope = scope
//     store.shopName = shopInfo.name
//     store.shopEmail = shopInfo.email
//     store.shopOwner = shopInfo.shop_owner
//     store.currency = shopInfo.currency
//     store.timezone = shopInfo.iana_timezone
//     store.isActive = true
//     store.uninstalledAt = undefined
//     store.region.country = shopInfo.country_name
//     store.region.countryCode = shopInfo.country_code
//     store.region.province = shopInfo.province
//     store.region.provinceCode = shopInfo.province_code
//     store.region.updatedAt = shopInfo.updated_at

//     await store.save()
//     logger.info(`Store ${isNew ? "created" : "updated"}: ${shop}`)

//     // Register webhooks
//     const topics = [
//       "products/create",
//       "products/update",
//       "products/delete",
//       "app/uninstalled",
//       "markets/update",
//     ]
//     await Promise.allSettled(
//       topics.map((topic) =>
//         shopifyService.registerWebhook(shop, accessToken, topic),
//       ),
//     )

//     // Kick off product sync (non-blocking)
//     productSyncService.syncAllProducts(store._id).catch((err) => {
//       logger.error("Initial product sync failed")
//       logger.error(err)
//       logger.error(err?.stack)
//     })

//      marketSyncService.syncStoreMarkets(store).catch((err) => {
//        logger.warn(`Initial market sync failed for ${shop}: ${err.message}`)
//      })

//     // Audit log
//     if (isNew || store.isActive !== true) {
//       await AuditLog.create({
//         storeId: store._id,
//         action: "STORE_INSTALLED",
//         entityType: "store",
//         entityId: store._id,
//         metadata: { isNew, shopName: shopInfo.name },
//         performedBy: "afterAuth",
//       })
//     }

//     // Issue JWT
//     const token = signToken(store._id, shop, store.plan)

//     res.json({
//       success: true,
//       token,
//       store: {
//         id: store._id,
//         shopDomain: store.shopDomain,
//         shopName: store.shopName,
//         plan: store.plan,
//       },
//     })
//   } catch (err) {
//     next(err)
//   }
// }

// /**
//  * GET /api/auth/me
//  * Returns the currently authenticated store's details.
//  * Called by the frontend after it has a valid JWT.
//  */
// async function getMe(req, res) {
//   const store = req.store

//   // Reset monthly quota if needed
//   store.resetMonthlyQuotaIfNeeded()

//   res.json({
//     success: true,
//     data: {
//       id: store._id,
//       shopDomain: store.shopDomain,
//       shopName: store.shopName,
//       shopEmail: store.shopEmail,
//       shopOwner: store.shopOwner,
//       currency: store.currency,
//       timezone: store.timezone,
//       plan: store.plan,
//       planExpiresAt: store.planExpiresAt,
//       planConfig: getPlanConfig(store.plan),
//       addons: store.addons || {},
//       promptLimits: store.getPromptLimits(),
//       faqStrategy: store.faqStrategy,
//       totalProductsSynced: store.totalProductsSynced,
//       lastSyncedAt: store.lastSyncedAt,
//       installedAt: store.installedAt,
//       tokenQuota: {
//         monthly: store.monthlyTokenQuota,
//         used: store.tokensUsedThisMonth,
//         remaining: store.getRemainingTokens(),
//         resetDate: store.tokenQuotaResetDate,
//       },
//       lifetime: {
//         tokensUsed: store.lifetimeTokensUsed,
//       },
//     },
//   })
// }

// async function getStoreToken(req, res) {
//   try {
//     let shop = req.shop

//     // Normalize shop domain
//     shop = shop.toLowerCase().trim()

//     const store = await Store.findOne({
//       shopDomain: shop,
//       isActive: true,
//     })

//     if (!store) {
//       return res.status(404).json({
//         success: false,
//         error: "Store not found. Please reinstall the app.",
//       })
//     }

//     const token = signToken(store._id, shop, store.plan)

//     return res.json({
//       success: true,
//       token,
//       store: {
//         id: store._id,
//         shopDomain: store.shopDomain,
//         shopName: store.shopName,
//         plan: store.plan,
//       },
//     })
//   } catch (err) {
//     console.error("Error in getStoreToken:", err)
//     return res.status(500).json({
//       success: false,
//       error: "Internal server error",
//     })
//   }
// }

// /**
//  * PATCH /api/stores/me/settings
//  * Update store preferences (e.g. FAQ strategy).
//  */
// async function updateStoreSettings(req, res, next) {
//   try {
//     const { faqStrategy } = req.body
//     const validStrategies = ["auto", "inline", "metafield"]

//     if (faqStrategy && !validStrategies.includes(faqStrategy)) {
//       return res.status(400).json({
//         success: false,
//         error: "faqStrategy must be auto, inline, or metafield",
//       })
//     }

//     if (faqStrategy) req.store.faqStrategy = faqStrategy
//     await req.store.save()

//     res.json({
//       success: true,
//       data: {
//         faqStrategy: req.store.faqStrategy,
//         planConfig: getPlanConfig(req.store.plan),
//         promptLimits: req.store.getPromptLimits(),
//       },
//     })
//   } catch (err) {
//     next(err)
//   }
// }

// /**
//  * GET /api/stores/plans
//  * Public pricing data for the app pricing page.
//  */
// async function listPlans(req, res) {
//   res.json({
//     success: true,
//     data: {
//       positioning: "Plans based on how many AI searches you want to win.",
//       plans: getAllPlans(),
//       addons: getAllAddons(),
//     },
//   })
// }

// /**
//  * GET /api/stores/billing
//  * Returns store billing info, usage stats, and key metrics.
//  */
// async function getStoreBillingInfo(req, res, next) {
//   try {
//     const store = req.store
//     store.resetMonthlyQuotaIfNeeded()

//     const storeId = store._id

//     // ─── Parallel queries for usage metrics ──────────────────────────
//     const [
//       totalProducts,
//       optimizedProducts,
//       analyzedProducts,
//       totalPrompts,
//       highVisibilityPrompts,
//     ] = await Promise.all([
//       Product.countDocuments({ storeId }),
//       Product.countDocuments({ storeId, isOptimized: true }),
//       ProductAnalysis.countDocuments({ storeId }),
//       ProductPrompt.countDocuments({ storeId }),
//       ProductPrompt.countDocuments({ storeId, visibility: "HIGH" }),
//     ])

//     // Prompt generation counts
//     const promptCounts = store.usage || {
//       productsAnalyzed: 0,
//       manualPromptsGenerated: 0,
//       autoPromptsGenerated: 0,
//     }

//     // Calculate next billing date
//     const nextBillingDate = store.planExpiresAt
//       ? new Date(store.planExpiresAt)
//       : null
//     const daysUntilExpiry = nextBillingDate
//       ? Math.ceil(
//           (nextBillingDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24),
//         )
//       : null

//     const planConfig = getPlanConfig(store.plan)
//     const planLimits = store.getPromptLimits()

//     res.json({
//       success: true,
//       data: {
//         // ─── Billing & Plan ──────────────────────────────────────────
//         plan: {
//           name: store.plan,
//           label: planConfig.label,
//           tagline: planConfig.tagline,
//           expiresAt: nextBillingDate,
//           daysUntilExpiry: daysUntilExpiry,
//           isExpired: daysUntilExpiry !== null && daysUntilExpiry < 0,
//         },

//         // ─── Token Quota ─────────────────────────────────────────────
//         tokenQuota: {
//           monthly: store.monthlyTokenQuota,
//           used: store.tokensUsedThisMonth,
//           remaining: store.getRemainingTokens(),
//           percentUsed: Math.round(
//             ((store.tokensUsedThisMonth || 0) /
//               (store.monthlyTokenQuota || 1)) *
//               100,
//           ),
//           resetDate: store.tokenQuotaResetDate,
//           lifetime: store.lifetimeTokensUsed,
//         },

//         // ─── Products & Analysis ────────────────────────────────────
//         products: {
//           total: totalProducts,
//           analyzed: analyzedProducts,
//           optimized: optimizedProducts,
//           notOptimized: totalProducts - optimizedProducts,
//           nextSyncScheduled: store.lastSyncedAt
//             ? new Date(
//                 new Date(store.lastSyncedAt).getTime() + 24 * 60 * 60 * 1000,
//               )
//             : null,
//           lastSyncedAt: store.lastSyncedAt,
//         },

//         // ─── Prompts & Intelligence ─────────────────────────────────
//         prompts: {
//           total: totalPrompts,
//           highVisibility: highVisibilityPrompts,
//           manual: promptCounts.manualPromptsGenerated || 0,
//           auto: promptCounts.autoPromptsGenerated || 0,
//           limits: {
//             maxPerProduct: planLimits.promptsPerProduct,
//             maxPromptsPerBatch: planLimits.maxPromptsPerBatch,
//           },
//         },

//         // ─── Usage Tracking ─────────────────────────────────────────
//         usage: {
//           productsAnalyzed: promptCounts.productsAnalyzed || 0,
//           maxProductsAnalyzed: planLimits.maxProductsAnalyzed,
//           canAnalyzeMore:
//             promptCounts.productsAnalyzed < planLimits.maxProductsAnalyzed,
//         },

//         // ─── Account ────────────────────────────────────────────────
//         account: {
//           shopDomain: store.shopDomain,
//           shopName: store.shopName,
//           currency: store.currency,
//           timezone: store.timezone,
//           installedAt: store.installedAt,
//           isActive: store.isActive,
//         },
//       },
//     })
//   } catch (err) {
//     next(err)
//   }
// }

// export {
//   registerStore,
//   getMe,
//   getStoreToken,
//   updateStoreSettings,
//   listPlans,
//   getStoreBillingInfo,
// }

import Store from "../models/store.model.js"
import AuditLog from "../models/auditlog.model.js"
import Product from "../models/product.model.js"
import ProductPrompt from "../models/product-prompt.model.js"
import ProductAnalysis from "../models/product-analysis.mode.js"
import * as shopifyService from "../services/shopify.service.js"
import * as marketSyncService from "../services/marketsync.service.js"
import { countActiveSyncedProducts } from "../middleware/plan-limits.js"
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
    let {
      shop,
      accessToken,
      scope,
      refreshToken,
      expiresAt,
      refreshTokenExpiresAt,
    } = req.body

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
    const wasInactive = store?.isActive === false

    if (!store) {
      store = new Store({ shopDomain: shop, plan: "starter" })
    }

    store.setAccessToken(accessToken)
    // Refresh token support (Shopify's expiring offline access token model).
    // Older sessions or reinstalls before this was wired up may not send
    // these — only touch the fields when actually present, so we never
    // overwrite a good stored refresh token with nothing.
    if (refreshToken) store.setRefreshToken(refreshToken)
    if (expiresAt) store.accessTokenExpiresAt = new Date(expiresAt)
    if (refreshTokenExpiresAt)
      store.refreshTokenExpiresAt = new Date(refreshTokenExpiresAt)
    store.scope = scope
    store.shopName = shopInfo.name
    store.shopEmail = shopInfo.email
    store.shopOwner = shopInfo.shop_owner
    store.currency = shopInfo.currency
    store.timezone = shopInfo.iana_timezone
    store.isActive = true
    store.uninstalledAt = undefined
    store.region.country = shopInfo.country_name
    store.region.countryCode = shopInfo.country_code
    store.region.province = shopInfo.province
    store.region.provinceCode = shopInfo.province_code
    store.region.updatedAt = shopInfo.updated_at

    await store.save()
    logger.info(`Store ${isNew ? "created" : "updated"}: ${shop}`)

    // Register webhooks using the stored access token to avoid any
    // mismatch between the token we just saved and the one received in
    // the request body (helps when tokens are rotated or persistence
    // modifies the stored value).
    // const topics = [
    //   "products/create",
    //   "products/update",
    //   "products/delete",
    //   "app/uninstalled",
    //   "markets/update",
    // ]

    // const storedToken = store.getAccessToken()
    // logger.info(
    //   `Registering webhooks for ${shop} using stored token preview ${storedToken ? storedToken.slice(0, 6) + "..." : "none"}`,
    // )

    // //console.log("token for register webhook", storedToken)

    // await Promise.allSettled(
    //   topics.map((topic) =>
    //     shopifyService.registerWebhook(shop, storedToken, topic),
    //   ),
    // )

    // NOTE: we no longer auto-sync all products on install. The frontend
    // now shows a picker (search + select, respecting the plan's sync
    // slot limit) right after this call returns, and calls
    // POST /products/sync-selected once the merchant confirms their choices.

    marketSyncService.syncStoreMarkets(store).catch((err) => {
      logger.warn(`Initial market sync failed for ${shop}: ${err.message}`)
    })

    // Audit log
    if (isNew || wasInactive) {
      await AuditLog.create({
        storeId: store._id,
        action: wasInactive ? "STORE_REACTIVATED" : "STORE_INSTALLED",
        entityType: "store",
        entityId: store._id,
        metadata: { isNew, wasInactive, shopName: shopInfo.name },
        performedBy: "afterAuth",
      })
    }

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

  const limits = store.getPromptLimits()
  const activeSyncedProducts = await countActiveSyncedProducts(store._id)

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
      promptLimits: limits,
      faqStrategy: store.faqStrategy,
      totalProductsSynced: store.totalProductsSynced,
      lastSyncedAt: store.lastSyncedAt,
      installedAt: store.installedAt,
      // NEW — lets the frontend decide whether to open the sync picker
      syncSlots: {
        used: activeSyncedProducts,
        limit: limits.maxProductsAnalyzed,
        remaining:
          limits.maxProductsAnalyzed === Infinity
            ? Infinity
            : Math.max(0, limits.maxProductsAnalyzed - activeSyncedProducts),
        needsSetup: activeSyncedProducts === 0,
      },
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

/**
 * GET /api/stores/billing
 * Returns store billing info, usage stats, and key metrics.
 */
async function getStoreBillingInfo(req, res, next) {
  try {
    const store = req.store
    store.resetMonthlyQuotaIfNeeded()

    const storeId = store._id

    // ─── Parallel queries for usage metrics ──────────────────────────
    const [
      totalProducts,
      optimizedProducts,
      analyzedProducts,
      totalPrompts,
      highVisibilityPrompts,
    ] = await Promise.all([
      Product.countDocuments({ storeId }),
      Product.countDocuments({ storeId, isOptimized: true }),
      ProductAnalysis.countDocuments({ storeId }),
      ProductPrompt.countDocuments({ storeId }),
      ProductPrompt.countDocuments({ storeId, visibility: "HIGH" }),
    ])

    // Prompt generation counts
    const promptCounts = store.usage || {
      productsAnalyzed: 0,
      manualPromptsGenerated: 0,
      autoPromptsGenerated: 0,
    }

    // Calculate next billing date
    const nextBillingDate = store.planExpiresAt
      ? new Date(store.planExpiresAt)
      : null
    const daysUntilExpiry = nextBillingDate
      ? Math.ceil(
          (nextBillingDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24),
        )
      : null

    const planConfig = getPlanConfig(store.plan)
    const planLimits = store.getPromptLimits()

    res.json({
      success: true,
      data: {
        // ─── Billing & Plan ──────────────────────────────────────────
        plan: {
          name: store.plan,
          label: planConfig.label,
          tagline: planConfig.tagline,
          expiresAt: nextBillingDate,
          daysUntilExpiry: daysUntilExpiry,
          isExpired: daysUntilExpiry !== null && daysUntilExpiry < 0,
        },

        // ─── Token Quota ─────────────────────────────────────────────
        tokenQuota: {
          monthly: store.monthlyTokenQuota,
          used: store.tokensUsedThisMonth,
          remaining: store.getRemainingTokens(),
          percentUsed: Math.round(
            ((store.tokensUsedThisMonth || 0) /
              (store.monthlyTokenQuota || 1)) *
              100,
          ),
          resetDate: store.tokenQuotaResetDate,
          lifetime: store.lifetimeTokensUsed,
        },

        // ─── Products & Analysis ────────────────────────────────────
        products: {
          total: totalProducts,
          analyzed: analyzedProducts,
          optimized: optimizedProducts,
          notOptimized: totalProducts - optimizedProducts,
          nextSyncScheduled: store.lastSyncedAt
            ? new Date(
                new Date(store.lastSyncedAt).getTime() + 24 * 60 * 60 * 1000,
              )
            : null,
          lastSyncedAt: store.lastSyncedAt,
        },

        // ─── Prompts & Intelligence ─────────────────────────────────
        prompts: {
          total: totalPrompts,
          highVisibility: highVisibilityPrompts,
          manual: promptCounts.manualPromptsGenerated || 0,
          auto: promptCounts.autoPromptsGenerated || 0,
          limits: {
            maxPerProduct: planLimits.promptsPerProduct,
            maxPromptsPerBatch: planLimits.maxPromptsPerBatch,
          },
        },

        // ─── Usage Tracking ─────────────────────────────────────────
        usage: {
          productsAnalyzed: promptCounts.productsAnalyzed || 0,
          maxProductsAnalyzed: planLimits.maxProductsAnalyzed,
          canAnalyzeMore:
            promptCounts.productsAnalyzed < planLimits.maxProductsAnalyzed,
        },

        // ─── Account ────────────────────────────────────────────────
        account: {
          shopDomain: store.shopDomain,
          shopName: store.shopName,
          currency: store.currency,
          timezone: store.timezone,
          installedAt: store.installedAt,
          isActive: store.isActive,
        },
      },
    })
  } catch (err) {
    next(err)
  }
}

export {
  registerStore,
  getMe,
  getStoreToken,
  updateStoreSettings,
  listPlans,
  getStoreBillingInfo,
}
