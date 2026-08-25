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

    const HEADER_FILL = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF111844" },
    }
    const HEADER_FONT = { bold: true, color: { argb: "FFFFFFFF" } }
    const YOU_FILL = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFE8F5EE" },
    }

    /**
     * The real shape of competitorBenchmark (see buildCompetitorBenchmark
     * in ai.service.js): columns = ["Feature / Signal", "You", ...real
     * competitor names], and competitors[] is actually a list of
     * comparison ROWS (one per signal/feature) — each entry's productName
     * is the FEATURE label (e.g. "FAQ Section"), not a competitor name,
     * and attributes.values is an array aligned 1:1 to columns.slice(1)
     * (values[0] = you, values[1] = columns[2], etc). This helper turns
     * that into something straightforward to render.
     */
    function parseBenchmark(bench) {
      const columns = bench?.columns || []
      const competitorNames = columns.slice(2) // columns[0] is the row-label header, columns[1] is "You"
      const rowsByFeature = new Map(
        (bench?.competitors || []).map((c) => [
          c.productName,
          c.attributes?.values || [],
        ]),
      )
      return { competitorNames, rowsByFeature }
    }

    // ── Overview sheet ────────────────────────────────────────────────
    const overview = workbook.addWorksheet("Overview")
    overview.mergeCells("A1:H1")
    overview.getCell("A1").value =
      'How to read this: "Gap" shows how many points your best-performing competitor is ahead of you on AI Visibility Score (negative means you\'re ahead of them instead).'
    overview.getCell("A1").font = {
      italic: true,
      size: 10,
      color: { argb: "FF5B5F6B" },
    }
    overview.getCell("A1").alignment = { wrapText: true }
    overview.getRow(1).height = 28

    overview.getRow(2).values = [
      "Product",
      "Your AI Visibility Score",
      "Toughest Competitor",
      "Competitor URL",
      "Their Score",
      "Gap",
      "Competitors Compared",
      "Signals Compared",
    ]
    overview.getRow(2).font = HEADER_FONT
    overview.getRow(2).fill = HEADER_FILL
    overview.columns = [
      { key: "product", width: 38 },
      { key: "myScore", width: 22 },
      { key: "topCompetitor", width: 30 },
      { key: "topCompetitorUrl", width: 42 },
      { key: "topScore", width: 14 },
      { key: "gap", width: 10 },
      { key: "competitorCount", width: 20 },
      { key: "dimensions", width: 45 },
    ]

    for (const a of rows) {
      const bench = a.competitorBenchmark || {}
      const { competitorNames, rowsByFeature } = parseBenchmark(bench)
      const scoreValues = rowsByFeature.get("AI Visibility Score") || []

      const myScore = Number(scoreValues[0]) || a.score || 0
      let topScore = null
      let topCompetitor = "—"
      let topCompetitorUrl = null
      const competitorUrls = bench.competitorUrls || []
      competitorNames.forEach((name, i) => {
        const val = Number(scoreValues[i + 1])
        if (!isNaN(val) && (topScore === null || val > topScore)) {
          topScore = val
          topCompetitor = name
          topCompetitorUrl = competitorUrls[i] || null
        }
      })
      const gap = topScore != null ? topScore - myScore : null

      const row = overview.addRow({
        product: a.productId?.title || "Unknown product",
        myScore,
        topCompetitor,
        topCompetitorUrl,
        topScore,
        gap,
        competitorCount: competitorNames.length,
        dimensions: (bench.categoryDimensions || [])
          .filter((d) => d !== "AI Visibility Score")
          .join(", "),
      })

      if (topCompetitorUrl) {
        const cell = row.getCell("topCompetitorUrl")
        cell.value = { text: topCompetitorUrl, hyperlink: topCompetitorUrl }
        cell.font = { color: { argb: "FF0563C1" }, underline: true }
      }

      if (gap != null) {
        const cell = row.getCell("gap")
        if (gap > 0) cell.font = { color: { argb: "FFBA1A1A" }, bold: true }
        else if (gap < 0)
          cell.font = { color: { argb: "FF00875A" }, bold: true }
      }
    }

    // ── Detail sheet — an actual side-by-side matrix, not a text blob ──
    const detail = workbook.addWorksheet("Detail")
    detail.getCell("A1").value =
      "✓ = your product / this competitor clearly shows this signal.   ✗ = missing.   Reviews = approximate review count.   AI Visibility Score = 0–100, higher is better."
    detail.getCell("A1").font = {
      italic: true,
      size: 10,
      color: { argb: "FF5B5F6B" },
    }
    detail.getRow(1).height = 20

    let currentRow = 3
    for (const a of rows) {
      const bench = a.competitorBenchmark || {}
      const { competitorNames, rowsByFeature } = parseBenchmark(bench)
      const dimensions = (bench.categoryDimensions || []).filter((d) =>
        rowsByFeature.has(d),
      )

      // Product title as a section header
      detail.mergeCells(currentRow, 1, currentRow, 2 + competitorNames.length)
      const titleCell = detail.getCell(currentRow, 1)
      titleCell.value = a.productId?.title || "Unknown product"
      titleCell.font = { bold: true, size: 12 }
      titleCell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFF3F0E8" },
      }
      currentRow++

      // Column headers: Signal | You | Competitor1 | Competitor2 | ...
      const headerRowNum = currentRow
      const headerValues = ["Signal", "You", ...competitorNames]
      headerValues.forEach((val, i) => {
        const cell = detail.getCell(headerRowNum, i + 1)
        cell.value = val
        cell.font = HEADER_FONT
        cell.fill = i === 1 ? YOU_FILL : HEADER_FILL
        if (i === 1) cell.font = { bold: true, color: { argb: "FF00875A" } }
      })
      competitorNames.forEach((name, i) => {
        const url = (bench.competitorUrls || [])[i]
        if (!url) return
        const cell = detail.getCell(headerRowNum, i + 3)
        cell.value = { text: name, hyperlink: url }
        cell.font = { bold: true, color: { argb: "FF0563C1" }, underline: true }
      })
      currentRow++

      for (const dim of dimensions) {
        const values = rowsByFeature.get(dim) || []
        const rowValues = [dim, ...values]
        rowValues.forEach((val, i) => {
          const cell = detail.getCell(currentRow, i + 1)
          cell.value = val ?? ""
          if (i === 1) cell.fill = YOU_FILL
        })
        currentRow++
      }
      currentRow += 2 // blank spacer row between products
    }

    // Column widths on the Detail sheet — first col wider for labels, rest even
    detail.getColumn(1).width = 30
    for (let i = 2; i <= 8; i++) detail.getColumn(i).width = 22

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
