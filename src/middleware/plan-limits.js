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
        return res.status(404).json({ success: false, error: "Product not found" })
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

export { countAnalyzedProducts, canAnalyzeProduct, enforceProductAnalysisLimit }
