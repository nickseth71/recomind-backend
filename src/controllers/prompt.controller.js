import mongoose from "mongoose"
import Product from "../models/product.model.js"
import ProductAnalysis from "../models/product-analysis.mode.js"
import ProductPrompt from "../models/product-prompt.model.js"
import PromptSimulation from "../models/promptsimulation.model.js"
import AuditLog from "../models/auditlog.model.js"
import * as aiService from "../services/ai.service.js"
import * as promptWinService from "../services/promptwin.service.js"
import { TOKEN_COSTS } from "../config/plans.js"
import logger from "../config/logger.js"
import crypto from "crypto"
import TokenReservation from "../models/token-reservation.model.js"

/**
 * GET /api/prompts/win-dashboard
 * Prompt Win Dashboard — lightweight summary (counts + coverage only).
 * For the actual prompt lists, see GET /api/prompts/win-dashboard/prompts.
 */
async function getWinDashboard(req, res, next) {
  try {
    if (!req.store.hasFeature("promptWinDashboard")) {
      return res.status(403).json({
        success: false,
        error: "Prompt Win Dashboard requires a plan upgrade",
        requiredFeature: "promptWinDashboard",
        currentPlan: req.store.plan,
      })
    }

    const data = await promptWinService.getPromptWinDashboard(
      req.store._id,
      req.store,
      { productId: req.query.productId },
    )

    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
}

/**
 * GET /api/prompts/win-dashboard/prompts
 * Paginated, categorized prompt list — the 4 dashboard tabs.
 * Query: category=missing|improve|winning|all, page, limit, search, productId
 */
async function getWinDashboardPrompts(req, res, next) {
  try {
    if (!req.store.hasFeature("promptWinDashboard")) {
      return res.status(403).json({
        success: false,
        error: "Prompt Win Dashboard requires a plan upgrade",
        requiredFeature: "promptWinDashboard",
        currentPlan: req.store.plan,
      })
    }

    const category = ["missing", "improve", "winning", "all"].includes(
      req.query.category,
    )
      ? req.query.category
      : "all"

    const data = await promptWinService.getPaginatedPrompts(req.store._id, {
      category,
      page: req.query.page,
      limit: req.query.limit,
      search: req.query.search,
      productId: req.query.productId,
    })

    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
}

/**
 * GET /api/prompts/products/:productId
 * List scored prompts for a product.
 */
async function getProductPrompts(req, res, next) {
  try {
    const product = await Product.findOne({
      _id: req.params.productId,
      storeId: req.store._id,
    })
    if (!product)
      return res
        .status(404)
        .json({ success: false, error: "Product not found" })

    const visibility = req.query.visibility
    const filter = { storeId: req.store._id, productId: product._id }
    if (visibility) filter.visibility = visibility.toUpperCase()

    const prompts = await ProductPrompt.find(filter)
      .sort({ intentCoverageScore: -1 })
      .lean()

    res.json({
      success: true,
      data: {
        product: { id: product._id, title: product.title },
        prompts,
        planLimits: req.store.getPromptLimits(),
      },
    })
  } catch (err) {
    next(err)
  }
}

/**
 * POST /api/prompts/products/:productId/generate
 * Generate and score prompts for a product.
 */
async function generateProductPrompts(req, res, next) {
  try {
    if (!req.store.hasFeature("promptWinDashboard")) {
      return res.status(403).json({
        success: false,
        error: "Prompt generation requires a plan upgrade",
        requiredFeature: "promptWinDashboard",
        currentPlan: req.store.plan,
      })
    }

    const manualPrompts = Array.isArray(req.body.prompts)
      ? req.body.prompts
          .map((p) => {
            if (typeof p === "string") return p
            if (p && typeof p.prompt === "string") return p.prompt
            return ""
          })
          .map((p) => p.trim())
          .filter(Boolean)
      : []
    const isManual = manualPrompts.length > 0

    if (isManual) {
      const limits = req.store.getPromptLimits()
      const manualLimit = limits.manualPromptsPerProduct
      const uniquePrompts = [...new Set(manualPrompts)].slice(0, manualLimit)
      const existingManualCount = await ProductPrompt.countDocuments({
        storeId: req.store._id,
        productId: req.params.productId,
        generatedBy: "manual",
      })

      const remainingManual = Math.max(0, manualLimit - existingManualCount)
      if (remainingManual <= 0) {
        return res.status(403).json({
          success: false,
          error: "Manual prompt limit reached for this product",
          limit: manualLimit,
          currentManualPrompts: existingManualCount,
        })
      }

      if (uniquePrompts.length > remainingManual) {
        return res.status(403).json({
          success: false,
          error: "Manual prompt generation would exceed the per-product limit",
          limit: manualLimit,
          currentManualPrompts: existingManualCount,
          remainingManualPrompts: remainingManual,
          requestedPrompts: uniquePrompts.length,
        })
      }
    }

    const tokenCost = TOKEN_COSTS.promptGeneration
    if (!req.store.canUseTokens(tokenCost)) {
      return res.status(429).json({
        success: false,
        error: "Insufficient token quota for this month",
        remainingTokens: req.store.getRemainingTokens(),
      })
    }

    const results = await promptWinService.generateAndScorePrompts(
      req.params.productId,
      req.store._id,
      req.store,
      { prompts: req.body.prompts, manual: isManual },
    )

    await req.store
      .deductTokens(tokenCost)
      .catch((e) => logger.warn(`Token deduct failed: ${e.message}`))

    await AuditLog.create({
      storeId: req.store._id,
      action: "PROMPTS_GENERATED",
      entityType: "product",
      entityId: req.params.productId,
      metadata: { count: results.length },
      performedBy: "user",
      ipAddress: req.ip,
    })

    res.json({
      success: true,
      message: `Generated and scored ${results.length} prompts`,
      data: results,
      tokensRemaining: req.store.getRemainingTokens(),
    })
  } catch (err) {
    next(err)
  }
}

/**
 * POST /api/prompts/score
 * Score a single prompt against a product.
 */
async function scorePrompt(req, res, next) {
  try {
    const { prompt, productId } = req.body
    if (!prompt || !productId) {
      return res.status(400).json({
        success: false,
        error: "prompt and productId are required",
      })
    }

    const tokenCost = TOKEN_COSTS.promptScoring
    if (!req.store.canUseTokens(tokenCost)) {
      return res.status(429).json({
        success: false,
        error: "Insufficient token quota",
        remainingTokens: req.store.getRemainingTokens(),
      })
    }

    const product = await Product.findOne({
      _id: productId,
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
    ).lean()

    const scored = await promptWinService.scorePromptForProduct(
      prompt,
      product,
      analysis,
    )

    await req.store.deductTokens(tokenCost).catch(() => {})

    res.json({
      success: true,
      data: scored,
      tokensRemaining: req.store.getRemainingTokens(),
    })
  } catch (err) {
    next(err)
  }
}

/**
 * GET /api/prompts/:promptId/fix
 * Get fix details for a low-scoring prompt.
 */
async function getPromptFix(req, res, next) {
  try {
    const data = await promptWinService.getPromptFix(
      req.params.promptId,
      req.store._id,
    )
    res.json({ success: true, data })
  } catch (err) {
    if (err.message === "Prompt not found") {
      return res.status(404).json({ success: false, error: err.message })
    }
    next(err)
  }
}

/**
 * GET /api/prompts/:promptId
 * Get full prompt details including product, latest analysis and fix recommendations
 */
async function getPromptDetails(req, res, next) {
  try {
    const promptId = req.params.promptId
    if (!promptId || !mongoose.Types.ObjectId.isValid(promptId)) {
      return res.status(400).json({
        success: false,
        error: "Invalid prompt id",
      })
    }

    const prompt = await ProductPrompt.findOne({
      _id: promptId,
      storeId: req.store._id,
    })
      .populate("productId", "title shopifyProductId")
      .lean()

    if (!prompt) {
      return res.status(404).json({ success: false, error: "Prompt not found" })
    }

    const productId = prompt.productId?._id || prompt.productId

    const analysis = productId
      ? await ProductAnalysis.findOne({ productId }, null, {
          sort: { createdAt: -1 },
        }).lean()
      : null

    let fix = null
    try {
      fix = await promptWinService.getPromptFix(promptId, req.store._id)
    } catch (e) {
      fix = null
    }

    res.json({
      success: true,
      data: {
        prompt,
        product: prompt.productId || null,
        analysis,
        fix,
        planLimits: req.store.getPromptLimits(),
      },
    })
  } catch (err) {
    next(err)
  }
}

/**
 * POST /api/prompts/simulate
 */
async function simulatePrompt(req, res, next) {
  try {
    const { prompt, productId } = req.body
    if (!prompt || !productId) {
      return res
        .status(400)
        .json({ success: false, error: "prompt and productId are required" })
    }

    if (!req.store.hasFeature("simulate")) {
      return res.status(403).json({
        success: false,
        error: "Prompt simulation requires Growth plan or higher",
        requiredFeature: "simulate",
        currentPlan: req.store.plan,
      })
    }

    if (!req.store.canUseTokens(TOKEN_COSTS.promptSimulation)) {
      return res.status(429).json({
        success: false,
        error: "Insufficient token quota for this month",
        remainingTokens: req.store.getRemainingTokens(),
      })
    }

    const product = await Product.findOne({
      _id: productId,
      storeId: req.store._id,
    })
    if (!product)
      return res
        .status(404)
        .json({ success: false, error: "Product not found" })

    const latestAnalysis = await ProductAnalysis.findOne(
      { productId: product._id },
      null,
      { sort: { createdAt: -1 } },
    ).lean()

    const result = await aiService.simulatePromptForProduct(
      prompt,
      product,
      latestAnalysis,
      req.store,
    )

    await req.store.deductTokens(TOKEN_COSTS.promptSimulation).catch(() => {})

    const simulation = await PromptSimulation.create({
      productId: product._id,
      storeId: req.store._id,
      prompt,
      recommendationScore: result.recommendationScore || 0,
      likelihood: result.likelihood || "LOW",
      buyerIntent: result.buyerIntent,
      expectedAttributes: result.expectedAttributes || [],
      missingSignals: result.missingSignals || [],
      rankingFactors: result.rankingFactors || [],
      competitorStrength: result.competitorStrength || "MODERATE",
      competitorDominating: result.competitorDominating || [],
      semanticGaps: result.semanticGaps || [],
      recommendations: result.recommendations || [],
      rawAiResponse: result.rawAiResponse,
      marketContext: result.marketContext || null,
    })

    await AuditLog.create({
      storeId: req.store._id,
      action: "PROMPT_SIMULATED",
      entityType: "prompt",
      entityId: simulation._id,
      metadata: { prompt, productId, score: result.recommendationScore },
      performedBy: "user",
      ipAddress: req.ip,
    })

    res.json({
      success: true,
      data: simulation,
      tokensRemaining: req.store.getRemainingTokens(),
    })
  } catch (err) {
    next(err)
  }
}

function parsePromptCsv(csv) {
  return String(csv || "")
    .split(/\r?\n/)
    .map((row) => row.trim())
    .filter(Boolean)
    .map((row) =>
      row
        .replace(/^\s*prompt\s*,?/i, "")
        .trim()
        .replace(/^"|"$/g, ""),
    )
    .filter(Boolean)
}

async function simulateCsv(req, res, next) {
  try {
    const { csv, productId } = req.body
    if (!csv || !productId)
      return res
        .status(400)
        .json({ success: false, error: "csv and productId are required" })
    const product = await Product.findOne({
      _id: productId,
      storeId: req.store._id,
    })
    if (!product)
      return res
        .status(404)
        .json({ success: false, error: "Product not found" })
    const prompts = parsePromptCsv(csv)
    const batchId = crypto
      .createHash("sha256")
      .update(`${productId}:${csv}`)
      .digest("hex")
    const analysis = await ProductAnalysis.findOne(
      { productId: product._id },
      null,
      { sort: { createdAt: -1 } },
    ).lean()
    const successful = []
    const skipped = []
    const remaining = []
    for (let index = 0; index < prompts.length; index += 1) {
      const prompt = prompts[index]
      const fingerprint = crypto
        .createHash("sha256")
        .update(prompt.trim().toLowerCase())
        .digest("hex")
      const rowNumber = index + 1
      const prior = await PromptSimulation.findOne({
        storeId: req.store._id,
        productId,
        promptFingerprint: fingerprint,
      }).lean()
      if (prior) {
        skipped.push(rowNumber)
        continue
      }
      const reservationKey = `${batchId}:${fingerprint}`
      const reservation = await TokenReservation.findOneAndUpdate(
        { storeId: req.store._id, key: reservationKey },
        {
          $setOnInsert: {
            amount: TOKEN_COSTS.promptSimulation,
            status: "reserved",
          },
        },
        { upsert: true, new: true },
      )
      if (
        reservation.status !== "reserved" ||
        reservation.createdAt < new Date(Date.now() - 60 * 60 * 1000)
      ) {
        remaining.push(rowNumber)
        continue
      }
      const claim = await TokenReservation.updateOne(
        { _id: reservation._id, status: "reserved" },
        { $set: { status: "processing" } },
      )
      if (claim.modifiedCount !== 1) {
        skipped.push(rowNumber)
        continue
      }
      try {
        await req.store.deductTokens(TOKEN_COSTS.promptSimulation)
        const result = await aiService.simulatePromptForProduct(
          prompt,
          product,
          analysis,
          req.store,
        )
        const simulation = await PromptSimulation.create({
          productId: product._id,
          storeId: req.store._id,
          prompt,
          sourceBatchId: batchId,
          sourceRowNumber: rowNumber,
          promptFingerprint: fingerprint,
          recommendationScore: result.recommendationScore || 0,
          likelihood: result.likelihood || "LOW",
          buyerIntent: result.buyerIntent,
          expectedAttributes: result.expectedAttributes || [],
          missingSignals: result.missingSignals || [],
          rankingFactors: result.rankingFactors || [],
          competitorStrength: result.competitorStrength || "MODERATE",
          competitorDominating: result.competitorDominating || [],
          semanticGaps: result.semanticGaps || [],
          recommendations: result.recommendations || [],
          rawAiResponse: result.rawAiResponse,
          marketContext: result.marketContext || null,
        })
        await TokenReservation.findByIdAndUpdate(reservation._id, {
          status: "completed",
          simulationId: simulation._id,
        })
        successful.push(rowNumber)
      } catch (error) {
        await req.store.refundTokens(TOKEN_COSTS.promptSimulation)
        await TokenReservation.findByIdAndUpdate(reservation._id, {
          status: "refunded",
        })
        if (error.statusCode === 429) {
          remaining.push(rowNumber)
          break
        }
        throw error
      }
    }
    const simulatedSet = new Set([...successful, ...skipped])
    for (let index = 1; index <= prompts.length; index += 1)
      if (!simulatedSet.has(index) && !remaining.includes(index))
        remaining.push(index)
    res.json({
      success: true,
      data: {
        batchId,
        total: prompts.length,
        simulatedPromptNumbers: [...successful, ...skipped].sort(
          (a, b) => a - b,
        ),
        newlySimulatedPromptNumbers: successful,
        skippedPromptNumbers: skipped,
        unsimulatedPromptNumbers: remaining.sort((a, b) => a - b),
        tokensRemaining: req.store.getRemainingTokens(),
        needsMoreTokens: remaining.length > 0,
      },
    })
  } catch (error) {
    next(error)
  }
}

/**
 * POST /api/prompts/analyse
 */
async function analysePromptIntelligence(req, res, next) {
  try {
    const { prompt } = req.body
    if (!prompt)
      return res
        .status(400)
        .json({ success: false, error: "prompt is required" })

    if (!req.store.hasFeature("promptIntelligence")) {
      return res.status(403).json({
        success: false,
        error: "Prompt Intelligence requires a plan upgrade",
        requiredFeature: "promptIntelligence",
        currentPlan: req.store.plan,
      })
    }

    if (!req.store.canUseTokens(TOKEN_COSTS.promptIntelligence)) {
      return res.status(429).json({
        success: false,
        error: "Insufficient token quota for this month",
        remainingTokens: req.store.getRemainingTokens(),
      })
    }

    const storeProducts = await Product.find(
      { storeId: req.store._id },
      "title",
    ).lean()

    const result = await aiService.analysePromptIntelligence(
      prompt,
      storeProducts,
    )

    await req.store.deductTokens(TOKEN_COSTS.promptIntelligence).catch(() => {})

    res.json({
      success: true,
      data: result,
      tokensRemaining: req.store.getRemainingTokens(),
    })
  } catch (err) {
    next(err)
  }
}

/**
 * GET /api/prompts/history
 */
async function getSimulationHistory(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1)
    const limit = Math.min(50, parseInt(req.query.limit) || 20)
    const skip = (page - 1) * limit

    const [simulations, total] = await Promise.all([
      PromptSimulation.find({ storeId: req.store._id })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate("productId", "title")
        .lean(),
      PromptSimulation.countDocuments({ storeId: req.store._id }),
    ])

    res.json({
      success: true,
      data: simulations,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    })
  } catch (err) {
    next(err)
  }
}

async function getSimulationDetail(req, res, next) {
  try {
    const simulation = await PromptSimulation.findOne({
      _id: req.params.id,
      storeId: req.store._id,
    })
      .populate("productId", "title images")
      .lean()

    if (!simulation) {
      return res
        .status(404)
        .json({ success: false, error: "Simulation not found" })
    }

    res.json({ success: true, data: simulation })
  } catch (err) {
    next(err)
  }
}

export {
  getWinDashboard,
  getProductPrompts,
  generateProductPrompts,
  scorePrompt,
  getPromptFix,
  getPromptDetails,
  simulatePrompt,
  simulateCsv,
  analysePromptIntelligence,
  getSimulationHistory,
  getSimulationDetail,
  getWinDashboardPrompts,
}
