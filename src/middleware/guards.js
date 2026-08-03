import Product from "../models/product.model.js"
import ProductAnalysis from "../models/product-analysis.mode.js"
import { TOKEN_COSTS } from "../config/plans.js"

/**
 * Each check is `async (req) => null | { status, body }`.
 * `null` means "passed, keep going". A returned object means "block here"
 * and is sent directly as the response.
 *
 * Checks are small and single-purpose on purpose — combine them per route
 * with guard(...checks) instead of writing bespoke validation in every
 * controller. Add a new check once, reuse it anywhere.
 */

/* ── Individual checks ──────────────────────────────────────────────── */

/**
 * Defense-in-depth: the global `authenticate` middleware already guarantees
 * req.store exists and is active on every authenticated route. This stays
 * cheap so guard chains remain safe to reuse in any future context (e.g. a
 * background/admin route) that might not go through `authenticate` first.
 */
async function checkStoreActive(req) {
  if (!req.store || !req.store.isActive) {
    return {
      status: 401,
      body: { success: false, error: "Store not found or inactive" },
    }
  }
  return null
}

/**
 * checkHasTokens(100) — READ-ONLY check, does not deduct anything.
 * Not safe on its own for gating a paid action against concurrent requests
 * (see reserveTokens below) — use this only where you genuinely just want
 * to know the answer without committing to it.
 */
function checkHasTokens(getAmount) {
  return async (req) => {
    const amount =
      typeof getAmount === "function" ? await getAmount(req) : getAmount
    if (!amount || amount <= 0) return null
    if (!req.store.canUseTokens(amount)) {
      return {
        status: 429,
        body: {
          success: false,
          error: "Insufficient token quota for this month",
          remainingTokens: req.store.getRemainingTokens(),
          required: amount,
          monthlyQuota: req.store.monthlyTokenQuota,
          nextResetDate: req.store.tokenQuotaResetDate,
        },
      }
    }
    return null
  }
}

/**
 * reserveTokens(100) — atomically CHECKS AND DEDUCTS in one DB operation.
 *
 * This is what actually prevents the race where several requests (e.g. 8
 * rapid single-analyse clicks) each see the same "600 remaining" balance
 * and all pass a plain check, because none of them have deducted yet —
 * tokens were only ever charged later, on job completion. By reserving at
 * enqueue time instead, each request competes for the real, current DB
 * balance: request #7 genuinely sees 0 remaining once #1–6 have reserved
 * their share, and gets blocked correctly instead of slipping through.
 *
 * On success, stores the deducted amount on req.tokensReserved so the
 * caller can refund it if enqueueing subsequently fails for an unrelated
 * (e.g. infra) reason — see analyseProduct/analyseBulk controllers.
 */
function reserveTokens(getAmount) {
  return async (req) => {
    const amount =
      typeof getAmount === "function" ? await getAmount(req) : getAmount
    if (!amount || amount <= 0) return null
    try {
      await req.store.deductTokens(amount)
      req.tokensReserved = (req.tokensReserved || 0) + amount
      return null
    } catch (err) {
      return {
        status: 429,
        body: {
          success: false,
          error: err.message,
          remainingTokens: err.remainingTokens,
          required: amount,
        },
      }
    }
  }
}

/**
 * Loads the target product (from req.params.id) and stashes it on
 * req.product so downstream checks and the controller don't re-query it.
 */
async function checkProductExists(req) {
  const product = await Product.findOne({
    _id: req.params.id,
    storeId: req.store._id,
  })
  if (!product) {
    return { status: 404, body: { success: false, error: "Product not found" } }
  }
  req.product = product
  return null
}

/**
 * Only relevant for a never-analysed product consuming a new plan slot.
 * Already-analysed products (reanalysis) never hit this — that's
 * checkReanalysisLimit's job instead.
 */
async function checkAnalysisSlotLimit(req) {
  const product = req.product
  if (!product || product.analysisScore != null) return null

  const limits = req.store.getPromptLimits()
  if (limits.maxProductsAnalyzed === Infinity) return null

  const analyzedCount = await Product.countDocuments({
    storeId: req.store._id,
    analysisScore: { $ne: null },
  })
  if (analyzedCount >= limits.maxProductsAnalyzed) {
    return {
      status: 403,
      body: {
        success: false,
        error: `Plan limit reached: ${limits.maxProductsAnalyzed} products analysed. Upgrade to analyse more.`,
        planLimit: {
          type: "maxProductsAnalyzed",
          limit: limits.maxProductsAnalyzed,
          used: analyzedCount,
          currentPlan: req.store.plan,
        },
      },
    }
  }
  return null
}

/**
 * Plan caps how many times a SINGLE product can be re-analysed
 * (limits.maxProductsReAnalyze — e.g. Starter = 1 reanalysis per product).
 * analyzationCount includes the first (non-reanalysis) run, so the number
 * of actual reanalyses is (analyzationCount - 1).
 *
 * When blocked, hands back the product's last saved analysis instead of a
 * bare error — a merchant who's hit the cap still gets something useful
 * rather than a dead end.
 */
async function checkReanalysisLimit(req) {
  const product = req.product
  if (!product || product.analysisScore == null) return null // first-time analysis, not a reanalysis

  const limits = req.store.getPromptLimits()
  const limit = limits.maxProductsReAnalyze
  if (!Number.isFinite(limit)) return null // Infinity/unset — unlimited on this plan

  const timesReanalyzed = Math.max(0, (product.analyzationCount || 0) - 1)

  if (timesReanalyzed >= limit) {
    const previousAnalysis = await ProductAnalysis.findOne(
      { productId: product._id },
      "score scoreBreakdown reasoning engineCoverage bestFor intentKeywords intentClusters missingSignals comparisonOpportunities trustSignals prioritizedFixes faq existingFaqs faqAnalysis smartPrompts interpretation competitorBenchmark optimizedTitle optimizedDescription",
      { sort: { createdAt: -1 } },
    ).lean()

    if (previousAnalysis) {
      return {
        status: 200,
        body: {
          success: true,
          message:
            "Re-analysis limit reached — returning the latest saved analysis",
          data: {
            jobId: null,
            productId: product._id,
            usingCached: true,
            analysis: previousAnalysis,
          },
        },
      }
    }

    return {
      status: 403,
      body: {
        success: false,
        error: `Re-analysis limit reached: this product has already been re-analysed ${timesReanalyzed} time${timesReanalyzed === 1 ? "" : "s"} (plan limit: ${limit}). Upgrade to re-analyse more.`,
        planLimit: {
          type: "maxProductsReAnalyze",
          limit,
          used: timesReanalyzed,
          currentPlan: req.store.plan,
        },
      },
    }
  }
  return null
}

/* ── Bulk-specific checks — operate over req.bulkTargets ─────────────── */

/**
 * Populates req.bulkTargets before the bulk guards run. If the caller
 * passed explicit productIds, use those (this is what makes bulk
 * RE-analysis possible — analyseBulk previously only ever picked
 * never-analysed products). Otherwise falls back to the original
 * "all un-analysed products" behavior.
 */
async function loadBulkTargets(req, res, next) {
  try {
    const { productIds } = req.body || {}
    let targets
    if (Array.isArray(productIds) && productIds.length > 0) {
      targets = await Product.find({
        _id: { $in: productIds },
        storeId: req.store._id,
      })
    } else {
      targets = await Product.find({
        storeId: req.store._id,
        analysisScore: null,
      })
    }
    req.bulkTargets = targets
    next()
  } catch (err) {
    next(err)
  }
}

async function reserveBulkTokenBudget(req) {
  const targets = req.bulkTargets || []
  const amount = targets.length * TOKEN_COSTS.productAnalysis
  if (amount <= 0) return null
  try {
    await req.store.deductTokens(amount)
    req.tokensReserved = (req.tokensReserved || 0) + amount
    return null
  } catch (err) {
    return {
      status: 429,
      body: {
        success: false,
        error: `Insufficient token quota: this batch of ${targets.length} product${targets.length === 1 ? "" : "s"} needs ${amount} tokens.`,
        remainingTokens: err.remainingTokens,
        required: amount,
      },
    }
  }
}

/**
 * Per-product reanalysis cap applied across a whole bulk batch. Unlike a
 * simple pass/fail guard, this trims req.bulkTargets in place — a bulk
 * request shouldn't fail entirely just because one product in it has hit
 * its own reanalysis limit; the rest of the batch should still proceed.
 * Skipped products are reported on req.skippedReanalysisTargets for the
 * controller to include in its response.
 */
function filterBulkReanalysisTargets(req, res, next) {
  const targets = req.bulkTargets || []
  const limits = req.store.getPromptLimits()
  const limit = limits.maxProductsReAnalyze

  if (!Number.isFinite(limit)) {
    req.skippedReanalysisTargets = []
    return next()
  }

  const eligible = []
  const skipped = []
  for (const p of targets) {
    const isReanalysis = p.analysisScore != null
    const timesReanalyzed = Math.max(0, (p.analyzationCount || 0) - 1)
    if (isReanalysis && timesReanalyzed >= limit) {
      skipped.push({ productId: p._id, title: p.title, timesReanalyzed, limit })
    } else {
      eligible.push(p)
    }
  }

  req.bulkTargets = eligible
  req.skippedReanalysisTargets = skipped
  next()
}

/* ── Combinator ────────────────────────────────────────────────────── */

/**
 * guard(checkA, checkB, checkC) -> Express middleware.
 * Runs each check in order; the first one to return a result short-circuits
 * the request with that status/body. If every check passes, calls next().
 */
function guard(...checks) {
  return async function (req, res, next) {
    try {
      for (const check of checks) {
        const result = await check(req)
        if (result) {
          return res.status(result.status).json(result.body)
        }
      }
      next()
    } catch (err) {
      next(err)
    }
  }
}

/* ── Pre-composed checklists — the ones routes actually import ───────── */

const singleAnalyseGuard = guard(
  checkStoreActive,
  checkProductExists,
  checkAnalysisSlotLimit,
  checkReanalysisLimit,
  reserveTokens(() => TOKEN_COSTS.productAnalysis),
)

// filterBulkReanalysisTargets must run BEFORE this — it trims
// req.bulkTargets down to eligible products first, so the reserved amount
// reflects the actual (possibly smaller) batch that will be enqueued.
const bulkAnalyseGuard = guard(checkStoreActive, reserveBulkTokenBudget)

export {
  guard,
  checkStoreActive,
  checkHasTokens,
  reserveTokens,
  checkProductExists,
  checkAnalysisSlotLimit,
  checkReanalysisLimit,
  loadBulkTargets,
  filterBulkReanalysisTargets,
  reserveBulkTokenBudget,
  singleAnalyseGuard,
  bulkAnalyseGuard,
}
