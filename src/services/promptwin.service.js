import ProductPrompt from "../models/product-prompt.model.js"
import Product from "../models/product.model.js"
import ProductAnalysis from "../models/product-analysis.mode.js"
import * as aiService from "./ai.service.js"
import {
  getPromptLimits,
  scoreToVisibility,
  visibilityLabel,
  visibilityMessage,
} from "../config/plans.js"
import logger from "../config/logger.js"

/**
 * Rule-based prompt templates — fallback when no smart prompts available.
 * Used only when analysis.smartPrompts is absent (e.g. legacy analyses).
 */
function generatePromptTemplates(product, analysis) {
  const category = product.productType || "product"
  const title = product.title || category
  const useCases = analysis?.bestFor?.slice(0, 5) || []
  const intents = analysis?.intentClusters?.slice(0, 5) || []
  const keywords = analysis?.intentKeywords?.slice(0, 5) || []

  const prompts = new Set()

  intents.forEach((p) => prompts.add(p))

  const templates = [
    `best ${category} for beginners`,
    `best ${title}`,
    `${category} for beginners`,
    `top rated ${category}`,
    `affordable ${category}`,
    `${title} review`,
    `is ${title} worth it`,
    `${category} comparison`,
    `what is the best ${category}`,
    `${category} buying guide`,
  ]

  templates.forEach((t) => prompts.add(t))
  useCases.forEach((uc) => {
    prompts.add(`best ${category} for ${uc}`)
    prompts.add(`${category} for ${uc}`)
  })
  keywords.forEach((kw) => {
    prompts.add(kw)
    prompts.add(`best ${kw}`)
  })

  const price = product.variants?.[0]?.price
  if (price) {
    const rounded = Math.ceil(parseFloat(price) / 10) * 10
    prompts.add(`${category} under $${rounded}`)
  }

  return [...prompts].filter(Boolean).slice(0, 20)
}

/**
 * Score a single prompt against a product using AI intent decomposition.
 * Accepts existingAnalysis so interpretation context is always passed through.
 */
async function scorePromptForProduct(prompt, product, analysis) {
  const result = await aiService.scorePromptVisibility(
    prompt,
    product,
    analysis,
  )

  const score = result.intentCoverageScore ?? result.recommendationScore ?? 0
  const visibility = scoreToVisibility(score)

  return {
    prompt,
    buyerIntent: result.buyerIntent,
    queryType: result.queryType,
    extractedAttributes:
      result.extractedAttributes || result.expectedAttributes || [],
    matchedAttributes: result.matchedAttributes || [],
    missingSignals: result.missingSignals || [],
    intentCoverageScore: score,
    visibility,
    statusMessage: visibilityMessage(visibility, prompt),
    visibilityLabel: visibilityLabel(visibility),
    recommendations: result.recommendations || [],
  }
}

/**
 * Generate and score prompts for a product, respecting plan limits.
 *
 * options.prompts        — pre-supplied prompt texts (skip generation)
 * options.existingAnalysis — full analysis with interpretation attached;
 *                            passed from startWorker so scoring gets full context
 * options.manual         — true if user-supplied prompts
 * options.maxPrompts     — override plan limit
 */
async function generateAndScorePrompts(
  productId,
  storeId,
  store,
  options = {},
) {
  const limits =
    store.getPromptLimits?.() || getPromptLimits(store.plan, store.addons)
  const maxPrompts = options.maxPrompts || limits.promptsPerProduct

  const product = await Product.findOne({ _id: productId, storeId })
  if (!product) throw new Error("Product not found")

  // Use passed-in analysis (with interpretation) if available;
  // otherwise fetch the latest from DB.
  const analysis =
    options.existingAnalysis ||
    (await ProductAnalysis.findOne({ productId: product._id }, null, {
      sort: { createdAt: -1 },
    }).lean())

  // ── Prompt source priority ─────────────────────────────────────────
  // 1. Manually supplied prompts (user typed them in)
  // 2. Smart prompts from Stage 3 (already in analysis.smartPrompts)
  // 3. Rule-based templates (legacy fallback)
  let promptTexts
  if (options.prompts?.length) {
    promptTexts = options.prompts
  } else if (analysis?.smartPrompts?.prompts?.length) {
    // Prefer high-value prompts first, then the rest
    const highValue = analysis.smartPrompts.highValuePrompts || []
    const allPrompts = analysis.smartPrompts.prompts.map((p) => p.prompt)
    const ordered = [
      ...highValue,
      ...allPrompts.filter((p) => !highValue.includes(p)),
    ]
    promptTexts = [...new Set(ordered)].filter(Boolean)
  } else {
    promptTexts = generatePromptTemplates(product, analysis)
  }

  const toProcess = promptTexts.slice(0, maxPrompts)
  const results = []

  // ── Batch score in chunks of 10 ───────────────────────────────────
  const BATCH_SIZE = 10
  for (let i = 0; i < toProcess.length; i += BATCH_SIZE) {
    const chunk = toProcess.slice(i, i + BATCH_SIZE)
    let scoredChunk = []

    try {
      // Pass analysis (with interpretation) for deeper, context-aware scoring
      const batchResults = await aiService.batchScorePrompts(
        chunk,
        product,
        analysis,
      )
      scoredChunk = batchResults.map((r, idx) => {
        const score = r.intentCoverageScore ?? 0
        const visibility = scoreToVisibility(score)
        return {
          prompt: r.prompt || chunk[idx],
          buyerIntent: r.buyerIntent,
          queryType: r.queryType,
          extractedAttributes: r.extractedAttributes || [],
          matchedAttributes: r.matchedAttributes || [],
          missingSignals: r.missingSignals || [],
          intentCoverageScore: score,
          visibility,
          statusMessage: visibilityMessage(visibility, r.prompt),
          recommendations: r.recommendations || [],
        }
      })
    } catch (err) {
      logger.warn(
        `Batch scoring failed, falling back to single: ${err.message}`,
      )
      for (const promptText of chunk) {
        try {
          scoredChunk.push(
            await scorePromptForProduct(promptText, product, analysis),
          )
        } catch (e) {
          logger.warn(`Failed to score "${promptText}": ${e.message}`)
        }
      }
    }

    // ── Upsert each scored prompt ──────────────────────────────────
    for (const scored of scoredChunk) {
      const promptText = scored.prompt
      if (!promptText) continue

      const trackedCount = await ProductPrompt.countDocuments({
        storeId,
        isTracked: true,
      })

      const canTrack =
        limits.totalTrackedPrompts === Infinity ||
        trackedCount < limits.totalTrackedPrompts

      const existing = await ProductPrompt.findOne({
        storeId,
        productId,
        prompt: promptText,
      })

      const scoreEntry = {
        score: scored.intentCoverageScore,
        visibility: scored.visibility,
        scoredAt: new Date(),
      }

      if (existing) {
        Object.assign(existing, {
          buyerIntent: scored.buyerIntent,
          queryType: scored.queryType,
          extractedAttributes: scored.extractedAttributes,
          matchedAttributes: scored.matchedAttributes,
          missingSignals: scored.missingSignals,
          intentCoverageScore: scored.intentCoverageScore,
          visibility: scored.visibility,
          statusMessage: scored.statusMessage,
          recommendations: scored.recommendations,
          lastScoredAt: new Date(),
        })
        if (limits.promptTracking) {
          existing.scoreHistory = [
            ...(existing.scoreHistory || []).slice(-11),
            scoreEntry,
          ]
        }
        await existing.save()
        results.push(existing)
      } else {
        const created = await ProductPrompt.create({
          productId: product._id,
          storeId,
          prompt: promptText,
          ...scored,
          isTracked: canTrack,
          lastScoredAt: new Date(),
          scoreHistory: limits.promptTracking ? [scoreEntry] : [],
          generatedBy: options.manual ? "manual" : "auto",
        })
        results.push(created)
      }
    }
  }

  return results
}

/**
 * Store-wide Prompt Win Dashboard summary.
 */
async function getPromptWinDashboard(storeId, store, filters = {}) {
  const limits =
    store.getPromptLimits?.() || getPromptLimits(store.plan, store.addons)
  const match = { storeId, isTracked: true }
  if (filters.productId) match.productId = filters.productId

  const [
    counts,
    topMissing,
    topWinning,
    recentPrompts,
    trackedCount,
    topImprove,
  ] = await Promise.all([
    ProductPrompt.aggregate([
      { $match: match },
      { $group: { _id: "$visibility", count: { $sum: 1 } } },
    ]),
    ProductPrompt.find({ ...match, visibility: "LOW" })
      .sort({ intentCoverageScore: 1 })
      .limit(10)
      .populate("productId", "title")
      .lean(),
    ProductPrompt.find({ ...match, visibility: "HIGH" })
      .sort({ intentCoverageScore: -1 })
      .limit(10)
      .populate("productId", "title")
      .lean(),
    ProductPrompt.find(match)
      .sort({ updatedAt: -1 })
      .limit(5)
      .populate("productId", "title")
      .lean(),
    ProductPrompt.countDocuments({ storeId, isTracked: true }),
    ProductPrompt.find({ ...match, visibility: "MEDIUM" })
      .sort({ intentCoverageScore: -1 })
      .limit(10)
      .populate("productId", "title")
      .lean(),
  ])

  const visibilityCounts = { HIGH: 0, MEDIUM: 0, LOW: 0 }
  counts.forEach((c) => {
    visibilityCounts[c._id] = c.count
  })

  return {
    summary: {
      canWin: visibilityCounts.HIGH,
      improve: visibilityCounts.MEDIUM,
      missing: visibilityCounts.LOW,
      total:
        visibilityCounts.HIGH + visibilityCounts.MEDIUM + visibilityCounts.LOW,
    },
    visibilityCounts,
    topMissing,
    topImprove,
    topWinning,
    recentPrompts,
    planLimits: {
      ...limits,
      trackedCount,
      remaining:
        limits.totalTrackedPrompts === Infinity
          ? Infinity
          : Math.max(0, limits.totalTrackedPrompts - trackedCount),
    },
  }
}

/**
 * Get fix details for a specific low-scoring prompt.
 */
async function getPromptFix(promptId, storeId) {
  const prompt = await ProductPrompt.findOne({ _id: promptId, storeId })
    .populate("productId", "title shopifyProductId")
    .lean()

  if (!prompt) throw new Error("Prompt not found")

  const analysis = await ProductAnalysis.findOne(
    { productId: prompt.productId?._id || prompt.productId },
    null,
    { sort: { createdAt: -1 } },
  ).lean()

  return {
    prompt,
    missingSignals: prompt.missingSignals || [],
    recommendations: prompt.recommendations || [],
    buyerIntent: prompt.buyerIntent,
    visibility: prompt.visibility,
    statusMessage: prompt.statusMessage,
    analysisId: analysis?._id,
    productId: prompt.productId?._id || prompt.productId,
    // Surface interpretation context for the Fix UI if available
    buyerObjections:
      analysis?.interpretation?.audienceProfile?.buyerObjections || [],
    primaryUseCase:
      analysis?.interpretation?.useCaseMap?.primaryUseCase || null,
    fixActions: [
      {
        type: "optimize",
        label: "Fix for this prompt",
        description:
          "Apply AI-optimized content including FAQs and intent signals to improve visibility for this buying intent",
      },
      {
        type: "add_faq",
        label: "Add missing FAQ signals",
        description:
          "Update or create FAQs that address the buyer intent behind this prompt",
        signals: (prompt.missingSignals || []).filter((s) =>
          /faq|question|answer/i.test(s),
        ),
      },
    ],
  }
}

export {
  generatePromptTemplates,
  scorePromptForProduct,
  generateAndScorePrompts,
  getPromptWinDashboard,
  getPromptFix,
}
