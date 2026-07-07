import Product from "../models/product.model.js"
import ProductAnalysis from "../models/product-analysis.mode.js"
import AuditLog from "../models/auditlog.model.js"
import {
  enqueueAnalysis,
  enqueueBulkAnalysis,
  getJobStatus,
} from "../jobs/analysisqueue.js"
import * as productSyncService from "../services/productsync.service.js"
import * as promptWinService from "../services/promptwin.service.js"
import { getPlanConfig, getPromptLimits } from "../config/plans.js"
import * as shopifyService from "../services/shopify.service.js"
import * as impactService from "../services/impact.service.js"
import { getRedis } from "../config/redis.js"
import logger from "../config/logger.js"
import crypto from "crypto"
import Store from "../models/store.model.js"

/**
 * Generate a deterministic hash of product content for change detection
 * This hash is used to detect if a product has been modified since last analysis
 */
function generateProductHash(product) {
  const content = JSON.stringify({
    title: product.title,
    description: product.description || "",
    tags: (product.tags || []).sort().join(","),
    productType: product.productType || "",
    vendor: product.vendor || "",
    variantCount: (product.variants || []).length,
    // Include variant details in hash
    variants: (product.variants || [])
      .map((v) => ({
        title: v.title,
        price: v.price,
        sku: v.sku,
      }))
      .sort((a, b) => (a.sku || "").localeCompare(b.sku || "")),
  })
  return crypto.createHash("sha256").update(content).digest("hex")
}

/**
 * GET /api/products
 * List all products for the authenticated store with pagination.
 */
async function listProducts(req, res, next) {
  try {
    const storeId = req.store._id
    const page = Math.max(1, parseInt(req.query.page) || 1)
    const limit = Math.min(100, parseInt(req.query.limit) || 20)
    const skip = (page - 1) * limit
    const search = (req.query.search || req.query.q || "").trim()

    const filter = { storeId }
    if (req.query.status) filter.status = req.query.status
    if (req.query.optimized !== undefined)
      filter.isOptimized = req.query.optimized === "true"
    if (search) {
      filter.$or = [
        { title: { $regex: search, $options: "i" } },
        { vendor: { $regex: search, $options: "i" } },
        { productType: { $regex: search, $options: "i" } },
        { handle: { $regex: search, $options: "i" } },
      ]
    }

    const sort = {}
    if (req.query.sort === "score_asc") sort.analysisScore = 1
    else if (req.query.sort === "score_desc") sort.analysisScore = -1
    else sort.createdAt = -1

    const [products, total, optimised, byScore] = await Promise.all([
      Product.find(filter).sort(sort).skip(skip).limit(limit).lean(),
      Product.countDocuments(filter),
      Product.countDocuments({ storeId, isOptimized: true }),
      Product.aggregate([
        { $match: { storeId, analysisScore: { $ne: null } } },
        {
          $group: {
            _id: null,
            avgScore: { $avg: "$analysisScore" },
            critical: {
              $sum: { $cond: [{ $lt: ["$analysisScore", 40] }, 1, 0] },
            },
          },
        },
      ]),
    ])

    const scoreStats = byScore[0] || { avgScore: 0, critical: 0 }

    res.json({
      success: true,
      data: products,
      avgScore: Math.round(scoreStats.avgScore || 0),
      optimisedCount: optimised,
      criticalCount: scoreStats.critical,
      unoptimisedCount: total - optimised,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    })
  } catch (err) {
    next(err)
  }
}

/**
 * GET /api/products/:id
 * Get a single product with its latest analysis.
 */
async function getProduct(req, res, next) {
  try {
    const product = await Product.findOne(
      { _id: req.params.id, storeId: req.store._id },
      "title productType vendor isOptimized images",
    ).lean()
    if (!product)
      return res
        .status(404)
        .json({ success: false, error: "Product not found" })

    const planLimits = req.store.getPromptLimits()
    const competitorCount = planLimits.competitorCount || 0

    const latestAnalysis = await ProductAnalysis.findOne(
      { productId: product._id },
      "score scoreBreakdown reasoning engineCoverage bestFor intentKeywords intentClusters missingSignals comparisonOpportunities trustSignals prioritizedFixes faq faqAnalysis smartPrompts interpretation competitorBenchmark",
      { sort: { createdAt: -1 } },
    ).lean()

    const analysis = latestAnalysis
      ? {
          ...latestAnalysis,
          competitorBenchmark:
            competitorCount > 0
              ? latestAnalysis.competitorBenchmark || null
              : null,
        }
      : null

    res.json({
      success: true,
      data: {
        product,
        analysis,
      },
    })
  } catch (err) {
    next(err)
  }
}

/**
 * POST /api/products/:id/analyse
 * Enqueue a single product for AI analysis.
 * If product details have changed since last analysis, run fresh analysis.
 * Otherwise, return the existing analysis.
 */
async function analyseProduct(req, res, next) {
  try {
    // Check if store has enough tokens
    const remainingTokens = req.store.getRemainingTokens()
    if (!req.store.canUseTokens(100)) {
      return res.status(429).json({
        success: false,
        error: "Insufficient token quota for this month",
        remainingTokens,
        monthlyQuota: req.store.monthlyTokenQuota,
        nextResetDate: req.store.tokenQuotaResetDate,
      })
    }

    const store = await Store.findById(req.store._id)

    const limits = getPromptLimits(store.plan, store.addons || {})
    const maxPrompts = limits.promptsPerProduct
    const maxProductAnalyzation = limits.maxProductsAnalyzed
    const maxProductReAnalyzation = limits.maxProductsReAnalyze

    const product = await Product.findOne({
      _id: req.params.id,
      storeId: req.store._id,
    })
    if (!product)
      return res
        .status(404)
        .json({ success: false, error: "Product not found" })

    if (store.usage.productsAnalyzed >= maxProductAnalyzation) {
      return res
        .status(404)
        .json({ success: false, error: "You limit has been reached" })
    }

    if (product.autoPromptsGenerated >= maxPrompts) {
      return res.status(404).json({
        success: false,
        message: "Your prompt generation limit has reached",
      })
    }

    if (product.analyzationCount >= maxProductReAnalyzation) {
      return res.status(404).json({
        success: false,
        message: "Your analyzation limit has reached for this product",
      })
    }

    // Generate current product hash
    const currentHash = generateProductHash(product)

    // Check if product has changed since last analysis
    const hasProductChanged =
      !product.lastAnalysedProductHash ||
      product.lastAnalysedProductHash !== currentHash

    // If product hasn't changed and has existing analysis, return it
    if (!hasProductChanged && product.lastAnalysedAt) {
      const existingAnalysis = await ProductAnalysis.findOne(
        { productId: product._id },
        null,
        { sort: { createdAt: -1 } },
      ).lean()

      if (existingAnalysis) {
        return res.json({
          success: true,
          message: "Product analysis up to date (no changes detected)",
          data: {
            jobId: null,
            productId: product._id,
            usingCached: true,
            analysis: existingAnalysis,
          },
        })
      }
    }

    // Product has changed or no previous analysis - queue fresh analysis
    const jobId = await enqueueAnalysis(product._id, req.store._id)

    // Update the product hash to mark it as queued for analysis
    await Product.findByIdAndUpdate(product._id, {
      lastAnalysedProductHash: currentHash,
    })

    res.json({
      success: true,
      message: hasProductChanged
        ? "Analysis queued (product updated)"
        : "Analysis job queued",
      data: {
        jobId,
        productId: product._id,
        productChanged: hasProductChanged,
        remainingTokens: remainingTokens - 100,
      },
    })
  } catch (err) {
    next(err)
  }
}

/**
 * POST /api/products/analyse-bulk
 * Enqueue all un-analysed products for analysis.
 */
async function analyseBulk(req, res, next) {
  try {
    const products = await Product.find(
      { storeId: req.store._id, analysisScore: null },
      "_id",
    ).lean()

    if (!products.length) {
      return res.json({
        success: true,
        message: "All products already analysed",
        jobsCreated: 0,
      })
    }

    const productIds = products.map((p) => p._id)
    const jobIds = await enqueueBulkAnalysis(productIds, req.store._id)

    await AuditLog.create({
      storeId: req.store._id,
      action: "BULK_OPTIMISE_STARTED",
      entityType: "store",
      entityId: req.store._id,
      metadata: { totalProducts: productIds.length },
      performedBy: "user",
      ipAddress: req.ip,
    })

    res.json({
      success: true,
      message: `Bulk analysis started for ${productIds.length} products`,
      data: { jobsCreated: jobIds.length, jobIds: jobIds.slice(0, 10) },
    })
  } catch (err) {
    next(err)
  }
}

/**
 * GET /api/products/:id/analysis
 * Get all analysis versions for a product.
 */
async function getAnalyses(req, res, next) {
  try {
    const product = await Product.findOne({
      _id: req.params.id,
      storeId: req.store._id,
    })
    if (!product)
      return res
        .status(404)
        .json({ success: false, error: "Product not found" })

    const analyses = await ProductAnalysis.find({ productId: product._id })
      .sort({ createdAt: -1 })
      .limit(10)
      .lean()

    res.json({ success: true, data: analyses })
  } catch (err) {
    next(err)
  }
}

async function getCompetitorBenchmark(req, res, next) {
  try {
    const product = await Product.findOne({
      _id: req.params.id,
      storeId: req.store._id,
    }).lean()
    if (!product)
      return res
        .status(404)
        .json({ success: false, error: "Product not found" })

    const latestAnalysis = await ProductAnalysis.findOne(
      { productId: product._id },
      null,
      { sort: { createdAt: -1 } },
    ).lean()

    if (!latestAnalysis)
      return res.status(404).json({
        success: false,
        error:
          "No analysis available for this product. Run product analysis first.",
      })

    const planLimits = req.store.getPromptLimits()
    const competitorCount = planLimits.competitorCount || 0
    const enabled = competitorCount > 0

    res.json({
      success: true,
      data: {
        enabled,
        competitorCount,
        competitorBenchmark: enabled
          ? latestAnalysis.competitorBenchmark || null
          : null,
        plan: req.store.plan,
      },
    })
  } catch (err) {
    next(err)
  }
}

/**
 * POST /api/products/:id/optimise
 * Apply the latest analysis to the Shopify product.
 */
async function optimiseProduct(req, res, next) {
  try {
    const product = await Product.findOne({
      _id: req.params.id,
      storeId: req.store._id,
    })
    if (!product)
      return res
        .status(404)
        .json({ success: false, error: "Product not found" })

    const analysis = await ProductAnalysis.findOne(
      { productId: product._id },
      null,
      { sort: { createdAt: -1 } },
    )

    if (!analysis) {
      return res.status(400).json({
        success: false,
        error: "No analysis found. Please run analysis first.",
      })
    }

    // Snapshot Shopify baseline metrics before pushing optimization
    await impactService.captureProductBaseline(req.store, product)

    const { faqStrategy, faqs, promptId } = req.body || {}
    const optimiseOptions = { faqStrategy }
    if (faqs?.length) optimiseOptions.faqs = faqs

    const optimiseResult = await productSyncService.applyOptimisationToShopify(
      req.store._id,
      product.shopifyProductId,
      analysis,
      optimiseOptions,
    )

    // Mark analysis as applied
    analysis.appliedToShopify = true
    analysis.appliedAt = new Date()
    analysis.appliedBy = "user"
    await analysis.save()

    // Mark product as optimised
    await Product.findByIdAndUpdate(product._id, { isOptimized: true })

    await AuditLog.create({
      storeId: req.store._id,
      action: "PRODUCT_OPTIMISED",
      entityType: "product",
      entityId: product._id,
      metadata: { analysisId: analysis._id, score: analysis.score },
      performedBy: "user",
      ipAddress: req.ip,
    })

    // Refresh post-optimization metrics from Shopify (async, non-blocking)
    impactService
      .recordProductPostOptimization(req.store, product, analysis.appliedAt)
      .catch(() => {})

    res.json({
      success: true,
      message: "Product optimised and pushed to Shopify",
      data: {
        analysisId: analysis._id,
        faqStrategy: optimiseResult.faqStrategy,
        faqsApplied: optimiseResult.faqsApplied,
        promptId: promptId || null,
      },
    })
  } catch (err) {
    next(err)
  }
}

/**
 * POST /api/products/:id/rollback
 * Roll back to the previous analysis version's content.
 */
async function rollbackProduct(req, res, next) {
  try {
    const { analysisId } = req.body
    const product = await Product.findOne({
      _id: req.params.id,
      storeId: req.store._id,
    })
    if (!product)
      return res
        .status(404)
        .json({ success: false, error: "Product not found" })

    const analysis = await ProductAnalysis.findOne({
      _id: analysisId,
      productId: product._id,
    })
    if (!analysis)
      return res
        .status(404)
        .json({ success: false, error: "Analysis version not found" })

    await productSyncService.applyOptimisationToShopify(
      req.store._id,
      product.shopifyProductId,
      analysis,
      { faqStrategy: req.body?.faqStrategy },
    )

    await AuditLog.create({
      storeId: req.store._id,
      action: "PRODUCT_OPTIMISATION_ROLLED_BACK",
      entityType: "product",
      entityId: product._id,
      metadata: { rolledBackToAnalysisId: analysisId },
      performedBy: "user",
      ipAddress: req.ip,
    })

    res.json({ success: true, message: "Rolled back to selected version" })
  } catch (err) {
    next(err)
  }
}

/**
 * POST /api/products/sync
 * Trigger a manual product sync from Shopify.
 */
async function syncProducts(req, res, next) {
  try {
    const count = await productSyncService.syncAllProducts(req.store._id)

    await AuditLog.create({
      storeId: req.store._id,
      action: "PRODUCTS_SYNCED",
      entityType: "store",
      entityId: req.store._id,
      metadata: { synced: count },
      performedBy: "user",
    })

    res.json({
      success: true,
      message: `Synced ${count} products`,
      data: { synced: count },
    })
  } catch (err) {
    next(err)
  }
}

/**
 * GET /api/products/jobs/:jobId — Check analysis job status.
 */
async function checkJobStatus(req, res, next) {
  try {
    const status = await getJobStatus(req.params.jobId)
    res.json({ success: true, data: status })
  } catch (err) {
    next(err)
  }
}

/**
 * GET /api/products/dashboard — Summary stats for the dashboard.
 *
 * Changes from previous version:
 * - Added interpretationQuality: breakdown of HIGH/MEDIUM/LOW confidence
 *   across recent analyses so frontend can show catalog data quality signal
 * - Added smartPromptPotential: win probability distribution from Stage 3
 *   smart prompts (different from promptWin which shows scored actuals)
 * - recentAnalyses now includes interpretation.audienceProfile.primaryBuyer
 *   and prioritizedFixes count so table rows can show richer context
 */
async function getDashboardStats(req, res, next) {
  try {
    const storeId = req.store._id

    const rawPeriod = req.query.timePeriod || "30days"
    const periodMap = {
      "30d": "30days",
      "3m": "3months",
      "6m": "6months",
      "30days": "30days",
      "3months": "3months",
      "6months": "6months",
    }
    const timePeriod = periodMap[rawPeriod] || rawPeriod

    if (!["30days", "3months", "6months"].includes(timePeriod)) {
      return res.status(400).json({
        success: false,
        message: "Invalid timePeriod. Use 30days, 3months or 6months.",
      })
    }

    const now = new Date()
    const dateFilter = new Date(now)
    switch (timePeriod) {
      case "30days":
        dateFilter.setDate(dateFilter.getDate() - 30)
        break
      case "3months":
        dateFilter.setMonth(dateFilter.getMonth() - 3)
        break
      case "6months":
        dateFilter.setMonth(dateFilter.getMonth() - 6)
        break
    }

    const redis = getRedis()
    const cacheKey = `dashboard:${storeId}:${timePeriod}`
    const cached = await redis.get(cacheKey).catch(() => null)
    if (cached) {
      return res.json({ success: true, data: JSON.parse(cached), cached: true })
    }

    // ── Parallel DB queries ───────────────────────────────────────────
    const [
      total,
      optimised,
      byScore,
      recentAnalysesRaw,
      engineCoverage,
      interpretationQualityRaw,
      smartPromptPotentialRaw,
    ] = await Promise.all([
      // 1. Total products
      Product.countDocuments({ storeId }),

      // 2. Optimised products
      Product.countDocuments({ storeId, isOptimized: true }),

      // 3. Score buckets + average
      Product.aggregate([
        { $match: { storeId, analysisScore: { $ne: null } } },
        {
          $group: {
            _id: null,
            avgScore: { $avg: "$analysisScore" },
            critical: {
              $sum: { $cond: [{ $lt: ["$analysisScore", 40] }, 1, 0] },
            },
            moderate: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $gte: ["$analysisScore", 40] },
                      { $lt: ["$analysisScore", 70] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            good: { $sum: { $cond: [{ $gte: ["$analysisScore", 70] }, 1, 0] } },
          },
        },
      ]),

      // 4. Recent analyses — now includes primaryBuyer and prioritizedFixes count
      //    so the table can show who the product is for and how many fixes exist
      ProductAnalysis.find({ storeId })
        .sort({ createdAt: -1 })
        .limit(5)
        .populate("productId", "title")
        .select(
          "_id productId productTitle images score bestFor appliedToShopify createdAt " +
            "interpretation.audienceProfile.primaryBuyer " + // NEW: who buys this
            "interpretation.productIdentity.productCategory " + // NEW: what it is
            "interpretation.productIdentity.confidence " + // NEW: interpretation quality
            "prioritizedFixes", // NEW: fix count/impact
        )
        .lean(),

      // 5. Average engine coverage over period
      ProductAnalysis.aggregate([
        { $match: { storeId, createdAt: { $gte: dateFilter } } },
        {
          $group: {
            _id: null,
            chatgpt: { $avg: "$engineCoverage.chatgpt" },
            perplexity: { $avg: "$engineCoverage.perplexity" },
            gemini: { $avg: "$engineCoverage.gemini" },
            aiOverview: { $avg: "$engineCoverage.aiOverview" },
            analysedProducts: { $sum: 1 },
          },
        },
      ]),

      // 6. NEW: Interpretation quality breakdown over the period
      //    Tells the merchant: how well does RecoMind understand your catalog?
      //    Driven by interpretation.productIdentity.confidence (HIGH/MEDIUM/LOW)
      ProductAnalysis.aggregate([
        { $match: { storeId, createdAt: { $gte: dateFilter } } },
        {
          $group: {
            _id: "$interpretation.productIdentity.confidence",
            count: { $sum: 1 },
          },
        },
      ]),

      // 7. NEW: Smart prompt win potential distribution
      //    Counts HIGH/MEDIUM/LOW winProbability across all smartPrompts.prompts
      //    in recent analyses — this is potential, not scored actuals
      ProductAnalysis.aggregate([
        { $match: { storeId, createdAt: { $gte: dateFilter } } },
        {
          $unwind: {
            path: "$smartPrompts.prompts",
            preserveNullAndEmptyArrays: false,
          },
        },
        {
          $group: {
            _id: "$smartPrompts.prompts.winProbability",
            count: { $sum: 1 },
          },
        },
      ]),
    ])

    // ── Shape results ─────────────────────────────────────────────────

    const stats = byScore[0] || {
      avgScore: 0,
      critical: 0,
      moderate: 0,
      good: 0,
    }
    const coverage = engineCoverage[0] || {
      chatgpt: 0,
      perplexity: 0,
      gemini: 0,
      aiOverview: 0,
      analysedProducts: 0,
    }

    // Interpretation quality: { HIGH: n, MEDIUM: n, LOW: n, UNKNOWN: n }
    const interpretationQuality = { HIGH: 0, MEDIUM: 0, LOW: 0, UNKNOWN: 0 }
    interpretationQualityRaw.forEach((r) => {
      const key = r._id || "UNKNOWN"
      interpretationQuality[key] = r.count
    })
    const totalInterpreted = Object.values(interpretationQuality).reduce(
      (a, b) => a + b,
      0,
    )
    interpretationQuality.total = totalInterpreted
    // Score: weighted quality pct (HIGH=100, MEDIUM=60, LOW=20)
    interpretationQuality.qualityScore = totalInterpreted
      ? Math.round(
          ((interpretationQuality.HIGH * 100 +
            interpretationQuality.MEDIUM * 60 +
            interpretationQuality.LOW * 20) /
            (totalInterpreted * 100)) *
            100,
        )
      : 0

    // Smart prompt potential: { HIGH: n, MEDIUM: n, LOW: n }
    const smartPromptPotential = { HIGH: 0, MEDIUM: 0, LOW: 0 }
    smartPromptPotentialRaw.forEach((r) => {
      if (r._id && smartPromptPotential[r._id] !== undefined) {
        smartPromptPotential[r._id] = r.count
      }
    })
    smartPromptPotential.total =
      smartPromptPotential.HIGH +
      smartPromptPotential.MEDIUM +
      smartPromptPotential.LOW

    // Shape recent analyses for table — slim down but keep new fields
    const recentAnalyses = recentAnalysesRaw.map((a) => ({
      _id: a._id,
      productId: a.productId,
      productTitle: a.productTitle,
      images: a.images,
      score: a.score,
      bestFor: a.bestFor,
      appliedToShopify: a.appliedToShopify,
      createdAt: a.createdAt,
      // NEW fields for table
      primaryBuyer: a.interpretation?.audienceProfile?.primaryBuyer || null,
      productCategory:
        a.interpretation?.productIdentity?.productCategory || null,
      interpretationConf: a.interpretation?.productIdentity?.confidence || null,
      highImpactFixes: (a.prioritizedFixes || []).filter(
        (f) => f.impact === "HIGH",
      ).length,
      totalFixes: (a.prioritizedFixes || []).length,
    }))

    // ── Prompt Win (feature-gated, unchanged) ─────────────────────────
    let promptWin = null
    if (req.store.hasFeature("promptWinDashboard")) {
      try {
        const raw = await promptWinService.getPromptWinDashboard(
          storeId,
          req.store,
        )
        if (raw) {
          const slim = (items = []) =>
            items.map(
              ({
                _id,
                productId,
                prompt,
                buyerIntent,
                missingSignals,
                intentCoverageScore,
                visibility,
              }) => ({
                _id,
                productId: productId
                  ? { _id: productId._id, title: productId.title }
                  : null,
                prompt,
                buyerIntent,
                missingSignals,
                intentCoverageScore,
                visibility,
              }),
            )
          promptWin = {
            summary: raw.summary,
            visibilityCounts: raw.visibilityCounts,
            topMissing: slim(raw.topMissing),
            topImprove: slim(raw.topImprove),
            topWinning: slim(raw.topWinning),
            planLimits: raw.planLimits,
          }
        }
      } catch (e) {
        logger.warn("Prompt win dashboard stats failed:", e.message)
      }
    }

    // ── Plan (unchanged) ──────────────────────────────────────────────
    const rawConfig = getPlanConfig(req.store.plan)
    const rawLimits = req.store.getPromptLimits()
    const plan = {
      name: req.store.plan,
      config: { label: rawConfig.label, tagline: rawConfig.tagline },
      limits: {
        maxProductsAnalyzed: rawLimits.maxProductsAnalyzed,
        promptsPerProduct: rawLimits.promptsPerProduct,
        scanFrequency: rawLimits.scanFrequency,
      },
      tokenQuota: {
        monthly: req.store.monthlyTokenQuota,
        used: req.store.tokensUsedThisMonth,
        remaining: req.store.getRemainingTokens(),
      },
    }

    // ── Assemble payload ──────────────────────────────────────────────
    const data = {
      totalProducts: total,
      optimisedProducts: optimised,
      avgAiScore: Math.round(stats.avgScore || 0),
      criticalProducts: stats.critical,
      moderateProducts: stats.moderate,
      goodProducts: stats.good,
      aiEngineCoverage: {
        chatgpt: Math.round(coverage.chatgpt || 0),
        perplexity: Math.round(coverage.perplexity || 0),
        gemini: Math.round(coverage.gemini || 0),
        aiOverview: Math.round(coverage.aiOverview || 0),
        analysedProducts: coverage.analysedProducts || 0,
        period: timePeriod,
      },
      // NEW: interpretation quality signal
      interpretationQuality,
      // NEW: smart prompt potential (potential vs promptWin's actuals)
      smartPromptPotential,
      promptWin,
      plan,
      recentAnalyses,
    }

    await redis.setex(cacheKey, 300, JSON.stringify(data)).catch(() => {})
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
}

export {
  listProducts,
  getProduct,
  analyseProduct,
  analyseBulk,
  getAnalyses,
  getCompetitorBenchmark,
  optimiseProduct,
  rollbackProduct,
  syncProducts,
  checkJobStatus,
  getDashboardStats,
}
