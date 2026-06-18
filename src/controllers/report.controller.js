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

    // Latest analysis per product
    const latestByProduct = {}
    for (const a of analyses) {
      const pid = a.productId.toString()
      if (!latestByProduct[pid]) latestByProduct[pid] = a
    }

    const productReports = products.map((p) => ({
      title: p.title,
      score: p.analysisScore,
      isOptimized: p.isOptimized,
      analysis: latestByProduct[p._id.toString()] || null,
    }))

    const avgScore = products.length
      ? Math.round(
          products.reduce((s, p) => s + (p.analysisScore || 0), 0) /
            products.length,
        )
      : 0

    const simStats = {
      total: simulations.length,
      high: simulations.filter((s) => s.likelihood === "HIGH").length,
      med: simulations.filter((s) => s.likelihood === "MED").length,
      low: simulations.filter((s) => s.likelihood === "LOW").length,
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
          criticalProducts: products.filter((p) => (p.analysisScore || 0) < 40)
            .length,
        },
        productReports,
        simulationStats: simStats,
        generatedAt: new Date().toISOString(),
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
