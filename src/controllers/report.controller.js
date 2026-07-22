import Product from "../models/product.model.js"
import ProductAnalysis from "../models/product-analysis.mode.js"
import PromptSimulation from "../models/promptsimulation.model.js"
import AuditLog from "../models/auditlog.model.js"
import * as aiService from "../services/ai.service.js"
import logger from "../config/logger.js"

/**
 * GET /api/reports/summary
 * Full AI visibility summary report for the store.
 */
async function getSummary(req, res, next) {
  try {
    const storeId = req.store._id

    const [products, analyses, simulations] = await Promise.all([
      Product.find({ storeId }).lean(),
      ProductAnalysis.find({ storeId }).sort({ createdAt: -1 }).lean(),
      PromptSimulation.find({ storeId })
        .sort({ createdAt: -1 })
        .limit(50)
        .lean(),
    ])

    const latestByProduct = {}
    for (const analysis of analyses) {
      const pid = analysis.productId?.toString?.() || analysis.productId
      if (!pid) continue
      if (!latestByProduct[pid]) latestByProduct[pid] = analysis
    }

    const productLookup = new Map(
      products.map((product) => [product._id.toString(), product]),
    )

    const analyzedProducts = Object.values(latestByProduct)
      .map((analysis) => {
        const productId = analysis.productId?.toString?.() || analysis.productId
        const product = productLookup.get(productId) || null

        return {
          id: productId,
          title: product?.title || analysis.productTitle || "Untitled product",
          score: Number.isFinite(analysis.score) ? analysis.score : 0,
          isOptimized: Boolean(product?.isOptimized),
          analysis,
        }
      })
      .filter((item) => item.score != null)

    const productReports = analyzedProducts.map((item) => ({
      title: item.title,
      score: item.score,
      isOptimized: item.isOptimized,
      analysis: item.analysis,
    }))

    const avgScore = analyzedProducts.length
      ? Math.round(
          analyzedProducts.reduce((sum, item) => sum + (item.score || 0), 0) /
            analyzedProducts.length,
        )
      : 0

    const simStats = {
      total: simulations.length,
      high: simulations.filter((s) => s.likelihood === "HIGH").length,
      med: simulations.filter((s) => s.likelihood === "MED").length,
      low: simulations.filter((s) => s.likelihood === "LOW").length,
    }

    const exportData = {
      generatedAt: new Date().toISOString(),
      store: {
        shopDomain: req.store.shopDomain,
        shopName: req.store.shopName,
        plan: req.store.plan,
      },
      summary: {
        totalProducts: products.length,
        avgAiScore: avgScore,
        optimisedProducts: products.filter((p) => p.isOptimized).length,
        criticalProducts: analyzedProducts.filter((item) => item.score < 40)
          .length,
      },
      products: analyzedProducts.map((item) => {
        const analysis = item.analysis
        const readinessGaps = analysis?.interpretation?.aiReadinessGaps || {}
        const recommendations = (analysis?.prioritizedFixes || [])
          .filter((fix) => fix?.fix)
          .slice(0, 5)
          .map(({ fix, impact, effort }) => ({ fix, impact, effort }))

        return {
          title: item.title,
          score: item.score,
          isOptimized: item.isOptimized,
          readiness: {
            status: item.isOptimized
              ? "Optimized"
              : item.score >= 70
                ? "Healthy"
                : "Needs attention",
            criticalGaps: readinessGaps.criticalGaps || [],
            moderateGaps: readinessGaps.moderateGaps || [],
            minorGaps: readinessGaps.minorGaps || [],
          },
          recommendations,
          signals: {
            bestFor: (analysis?.bestFor || []).slice(0, 5),
            missingSignals: (analysis?.missingSignals || []).slice(0, 5),
            comparisonOpportunities: (
              analysis?.comparisonOpportunities || []
            ).slice(0, 5),
          },
        }
      }),
      simulationSummary: simStats,
    }

    res.json({
      success: true,
      data: {
        store: {
          shopDomain: req.store.shopDomain,
          shopName: req.store.shopName,
          plan: req.store.plan,
        },
        summary: {
          totalProducts: products.length,
          avgAiScore: avgScore,
          optimisedProducts: products.filter((p) => p.isOptimized).length,
          criticalProducts: analyzedProducts.filter((item) => item.score < 40)
            .length,
        },
        productReports,
        simulationStats: simStats,
        generatedAt: new Date().toISOString(),
        exportData,
      },
    })
  } catch (err) {
    next(err)
  }
}

/**
 * GET /api/reports/llms-txt
 * Generate llms.txt content for this store.
 */
async function generateLlmsTxt(req, res, next) {
  try {
    const products = await Product.find({ storeId: req.store._id }).lean()
    const content = await aiService.generateLlmsTxt(req.store, products)

    res.setHeader("Content-Type", "text/plain; charset=utf-8")
    res.setHeader("Content-Disposition", `attachment; filename="llms.txt"`)

    await AuditLog.create({
      storeId: req.store._id,
      action: "REPORT_EXPORTED",
      entityType: "store",
      entityId: req.store._id,
      metadata: { type: "llms.txt" },
      performedBy: "user",
    })

    res.send(content)
  } catch (err) {
    next(err)
  }
}

/**
 * GET /api/reports/audit-log
 * Get audit log entries for the store.
 */
async function getAuditLog(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1)
    const limit = Math.min(100, parseInt(req.query.limit) || 30)
    const skip = (page - 1) * limit

    const [logs, total] = await Promise.all([
      AuditLog.find({ storeId: req.store._id })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      AuditLog.countDocuments({ storeId: req.store._id }),
    ])

    res.json({
      success: true,
      data: logs,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    })
  } catch (err) {
    next(err)
  }
}

export { getSummary, generateLlmsTxt, getAuditLog }
