import Product from "../models/product.model.js"
import ProductAnalysis from "../models/product-analysis.mode.js"
import PromptSimulation from "../models/promptsimulation.model.js"
import AuditLog from "../models/auditlog.model.js"
import * as aiService from "../services/ai.service.js"
import logger from "../config/logger.js"
import ExcelJS from "exceljs"

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
 * GET /api/reports/competitor-gap
 * Competitor Gap Report (.xlsx) — Growth+ only (gated by "competitorGap"
 * feature). Two sheets: a scannable Overview (one row per product, gap
 * vs best competitor) and a Detail sheet (every competitor row, every
 * product, with the merchant's own row marked so it's easy to compare).
 */
async function generateCompetitorGapReport(req, res, next) {
  try {
    const analyses = await ProductAnalysis.find({
      storeId: req.store._id,
      "competitorBenchmark.competitors.0": { $exists: true },
    })
      .sort({ createdAt: -1 })
      .populate("productId", "title")
      .lean()

    // Keep only the latest analysis per product (already sorted newest
    // first, so the first one seen per product wins).
    const latestByProduct = new Map()
    for (const a of analyses) {
      const pid = String(a.productId?._id || a.productId)
      if (!latestByProduct.has(pid)) latestByProduct.set(pid, a)
    }
    const rows = [...latestByProduct.values()]

    const workbook = new ExcelJS.Workbook()
    workbook.creator = "RecoMind"
    workbook.created = new Date()

    // ── Overview sheet ────────────────────────────────────────────────
    const overview = workbook.addWorksheet("Overview")
    overview.columns = [
      { header: "Product", key: "product", width: 38 },
      { header: "Your AI Visibility Score", key: "myScore", width: 22 },
      { header: "Top Competitor", key: "topCompetitor", width: 32 },
      { header: "Top Competitor Score", key: "topScore", width: 20 },
      { header: "Gap", key: "gap", width: 10 },
      { header: "Competitors Tracked", key: "competitorCount", width: 20 },
      { header: "Category Dimensions Compared", key: "dimensions", width: 40 },
    ]
    overview.getRow(1).font = { bold: true }
    overview.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF111844" },
    }
    overview.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } }

    for (const a of rows) {
      const bench = a.competitorBenchmark || {}
      const competitors = bench.competitors || []
      const mine = competitors.find((c) => c.isMerchantProduct)
      const others = competitors.filter((c) => !c.isMerchantProduct)
      const topCompetitor = others.reduce(
        (best, c) =>
          (c.aiVisibilityScore || 0) > (best?.aiVisibilityScore || 0)
            ? c
            : best,
        null,
      )
      const myScore = mine?.aiVisibilityScore ?? a.score ?? null
      const topScore = topCompetitor?.aiVisibilityScore ?? null
      const gap =
        myScore != null && topScore != null ? topScore - myScore : null

      const row = overview.addRow({
        product: a.productId?.title || "Unknown product",
        myScore,
        topCompetitor: topCompetitor?.productName || "—",
        topScore,
        gap,
        competitorCount: others.length,
        dimensions: (bench.categoryDimensions || []).join(", "),
      })

      // Highlight a real gap (competitor ahead) in red, a lead in green
      if (gap != null) {
        const cell = row.getCell("gap")
        if (gap > 0) {
          cell.font = { color: { argb: "FFBA1A1A" }, bold: true }
        } else if (gap < 0) {
          cell.font = { color: { argb: "FF00875A" }, bold: true }
        }
      }
    }

    // ── Detail sheet ──────────────────────────────────────────────────
    const detail = workbook.addWorksheet("Detail")
    detail.columns = [
      { header: "Product", key: "product", width: 32 },
      { header: "Competitor / Your Product", key: "competitor", width: 32 },
      { header: "Is Your Product?", key: "isMine", width: 16 },
      { header: "AI Visibility Score", key: "score", width: 18 },
      { header: "Has FAQ Section", key: "hasFaq", width: 16 },
      { header: "Has Customer Reviews", key: "hasReviews", width: 20 },
      { header: "Key Attributes", key: "attributes", width: 50 },
    ]
    detail.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } }
    detail.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF111844" },
    }

    for (const a of rows) {
      const bench = a.competitorBenchmark || {}
      const productTitle = a.productId?.title || "Unknown product"
      for (const c of bench.competitors || []) {
        const attrs = c.attributes
          ? Object.entries(c.attributes)
              .map(([k, v]) => `${k}: ${v}`)
              .join(" | ")
          : ""
        const row = detail.addRow({
          product: productTitle,
          competitor: c.productName || "—",
          isMine: c.isMerchantProduct ? "Yes" : "No",
          score: c.aiVisibilityScore ?? "",
          hasFaq: c.faqSection ? "Yes" : "No",
          hasReviews: c.customerReviews ? "Yes" : "No",
          attributes: attrs,
        })
        if (c.isMerchantProduct) {
          row.eachCell((cell) => {
            cell.fill = {
              type: "pattern",
              pattern: "solid",
              fgColor: { argb: "FFE8F5EE" },
            }
          })
        }
      }
    }

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="competitor-gap-report-${new Date().toISOString().slice(0, 10)}.xlsx"`,
    )

    await AuditLog.create({
      storeId: req.store._id,
      action: "REPORT_EXPORTED",
      entityType: "store",
      entityId: req.store._id,
      metadata: { type: "competitor-gap-xlsx", productCount: rows.length },
      performedBy: "user",
    })

    await workbook.xlsx.write(res)
    res.end()
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

export { getSummary, generateLlmsTxt, getAuditLog, generateCompetitorGapReport }
