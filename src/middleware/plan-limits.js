import Product from "../models/product.model.js"
import { getPlanConfig, getPromptLimits } from "../config/plans.js"

/**
 * Count products that have been analyzed at least once.
 */
async function countAnalyzedProducts(storeId) {
  return Product.countDocuments({
    storeId,
    lastAnalysedAt: { $ne: null },
  })
}

/**
 * Check if store can analyze a new product (plan product limit).
 */
async function canAnalyzeProduct(store, product) {
  const limits = store.getPromptLimits()
  if (limits.maxProductsAnalyzed === Infinity) {
    return { allowed: true }
  }

  // Re-analysis of already-analyzed product is always allowed
  if (product.lastAnalysedAt) {
    return { allowed: true }
  }

  const analyzedCount = await countAnalyzedProducts(store._id)
  if (analyzedCount >= limits.maxProductsAnalyzed) {
    return {
      allowed: false,
      reason: `Plan limit reached: ${limits.maxProductsAnalyzed} products analyzed. Upgrade to analyze more.`,
      analyzedCount,
      limit: limits.maxProductsAnalyzed,
      currentPlan: store.plan,
    }
  }

  return { allowed: true, analyzedCount, limit: limits.maxProductsAnalyzed }
}

/**
 * Express middleware — block if plan product limit exceeded.
 */
function enforceProductAnalysisLimit() {
  return async (req, res, next) => {
    try {
      const product = await Product.findOne({
        _id: req.params.id,
        storeId: req.store._id,
      })
      if (!product) {
        return res
          .status(404)
          .json({ success: false, error: "Product not found" })
      }

      const check = await canAnalyzeProduct(req.store, product)
      if (!check.allowed) {
        return res.status(403).json({
          success: false,
          error: check.reason,
          planLimit: {
            type: "maxProductsAnalyzed",
            limit: check.limit,
            used: check.analyzedCount,
            currentPlan: check.currentPlan,
          },
        })
      }

      req.product = product
      next()
    } catch (err) {
      next(err)
    }
  }
}

/**
 * Count products currently occupying a sync slot (i.e. selected and not removed).
 * Removed products don't count — this is what frees up a slot.
 */
async function countActiveSyncedProducts(storeId) {
  return Product.countDocuments({
    storeId,
    isRemovedFromSync: { $ne: true },
  })
}

/**
 * Check whether `count` additional products can be synced without
 * exceeding the plan's product slot limit.
 */
async function canSyncProducts(store, count = 1) {
  const limits = store.getPromptLimits()
  if (limits.maxProductsAnalyzed === Infinity) {
    return { allowed: true }
  }

  const activeCount = await countActiveSyncedProducts(store._id)
  const remaining = limits.maxProductsAnalyzed - activeCount

  if (count > remaining) {
    return {
      allowed: false,
      reason:
        remaining <= 0
          ? `Plan limit reached: ${limits.maxProductsAnalyzed} products synced. Remove a product or upgrade to add more.`
          : `Only ${remaining} sync slot${remaining === 1 ? "" : "s"} remaining on your plan — you selected ${count}.`,
      activeCount,
      remaining: Math.max(0, remaining),
      limit: limits.maxProductsAnalyzed,
      currentPlan: store.plan,
    }
  }

  return {
    allowed: true,
    activeCount,
    remaining,
    limit: limits.maxProductsAnalyzed,
  }
}

/**
 * Express middleware — block bulk sync requests that would exceed the plan limit.
 * Expects req.body.shopifyProductIds (array).
 */
function enforceProductSyncLimit() {
  return async (req, res, next) => {
    try {
      const ids = req.body?.shopifyProductIds
      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({
          success: false,
          error: "shopifyProductIds must be a non-empty array",
        })
      }

      const check = await canSyncProducts(req.store, ids.length)
      if (!check.allowed) {
        return res.status(403).json({
          success: false,
          error: check.reason,
          planLimit: {
            type: "maxProductsSynced",
            limit: check.limit,
            used: check.activeCount,
            remaining: check.remaining,
            currentPlan: check.currentPlan,
          },
        })
      }

      req.syncSlotInfo = check
      next()
    } catch (err) {
      next(err)
    }
  }
}

export {
  countAnalyzedProducts,
  canAnalyzeProduct,
  enforceProductAnalysisLimit,
  countActiveSyncedProducts,
  canSyncProducts,
  enforceProductSyncLimit,
}
