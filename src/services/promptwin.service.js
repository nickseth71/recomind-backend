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
// ─────────────────────────────────────────────────────────────
// winProbability (Stage 3) → visibility (ProductPrompt) mapping
// These are deliberately the SAME scale — HIGH/MEDIUM/LOW — so the
// dashboard never disagrees with the analysis tab on the same prompt.
// ─────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────
// winProbability (Stage 3) → visibility (ProductPrompt) mapping
// These are deliberately the SAME scale — HIGH/MEDIUM/LOW — so the
// dashboard never disagrees with the analysis tab on the same prompt.
// ─────────────────────────────────────────────────────────────
function winProbabilityToVisibility(wp) {
  if (wp === "HIGH" || wp === "MEDIUM" || wp === "LOW") return wp
  return "LOW" // unknown/missing defaults conservative, same as before
}

// Score bands per visibility bucket. The AI still generates a real
// 0-100 intentCoverageScore per prompt (so prompts within the same
// bucket can differ — e.g. two HIGH prompts as 78 and 94), but we
// clamp it into the band that matches Stage 3's winProbability so
// the bucket label and the numeric score never contradict each other.
const VISIBILITY_SCORE_BAND = {
  HIGH: { min: 70, max: 100 },
  MEDIUM: { min: 40, max: 69 },
  LOW: { min: 0, max: 39 },
}

function clampScoreToBand(score, visibility) {
  const band = VISIBILITY_SCORE_BAND[visibility] || VISIBILITY_SCORE_BAND.LOW
  return Math.min(band.max, Math.max(band.min, Math.round(score)))
}

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
  // 1. Manually supplied prompts (plain strings, no winProbability)
  // 2. Pre-generated Stage 3 smart prompts (full objects WITH winProbability)
  // 3. Smart prompts already in analysis.smartPrompts (same as #2, fallback path)
  // 4. Rule-based templates (legacy fallback, no winProbability)
  //
  // promptObjects: [{ prompt, winProbability?, intent, promptType, targetedAttribute }, ...]
  // Entries WITHOUT winProbability are scored fully fresh (visibility + score).
  // Entries WITH winProbability are AI-scored too, but the score is clamped
  // to match the winProbability band so visibility never disagrees with Stage 3.
  let promptObjects

  if (options.prompts?.length && typeof options.prompts[0] === "object") {
    promptObjects = options.prompts
  } else if (options.prompts?.length) {
    promptObjects = options.prompts.map((p) => ({ prompt: p }))
  } else if (analysis?.smartPrompts?.prompts?.length) {
    const highValue = analysis.smartPrompts.highValuePrompts || []
    const allPrompts = analysis.smartPrompts.prompts
    const promptMap = new Map(allPrompts.map((p) => [p.prompt, p]))
    const orderedTexts = [
      ...highValue,
      ...allPrompts.map((p) => p.prompt).filter((p) => !highValue.includes(p)),
    ]
    const seen = new Set()
    promptObjects = orderedTexts
      .filter((p) => {
        if (seen.has(p)) return false
        seen.add(p)
        return true
      })
      .map((p) => promptMap.get(p) || { prompt: p })
  } else {
    const templates = generatePromptTemplates(product, analysis)
    promptObjects = templates.map((p) => ({ prompt: p }))
  }

  const toProcess = promptObjects.slice(0, maxPrompts).filter((p) => p.prompt)
  const results = []
  const promptMetaByText = new Map(toProcess.map((p) => [p.prompt, p]))

  // ── AI-score every prompt in batches (real per-prompt variance) ─────
  const BATCH_SIZE = 10
  let allScored = []
  for (let i = 0; i < toProcess.length; i += BATCH_SIZE) {
    const chunkObjs = toProcess.slice(i, i + BATCH_SIZE)
    const chunk = chunkObjs.map((p) => p.prompt)
    if (!chunk.length) continue

    try {
      const batchResults = await aiService.batchScorePrompts(
        chunk,
        product,
        analysis,
      )
      allScored.push(
        ...batchResults.map((r, idx) => {
          const promptText = r.prompt || chunk[idx]
          const meta = promptMetaByText.get(promptText) || {}
          const rawScore = r.intentCoverageScore ?? 0

          // If Stage 3 already gave a winProbability for this prompt,
          // lock the visibility bucket to that and clamp the AI's
          // fresh score into the matching band. Otherwise let the
          // AI score determine visibility from scratch (manual prompts,
          // legacy templates).
          const visibility = meta.winProbability
            ? winProbabilityToVisibility(meta.winProbability)
            : scoreToVisibility(rawScore)

          const score = meta.winProbability
            ? clampScoreToBand(rawScore, visibility)
            : rawScore

          return {
            prompt: promptText,
            buyerIntent: r.buyerIntent || meta.intent || "",
            queryType: r.queryType || meta.promptType || "",
            extractedAttributes:
              r.extractedAttributes ||
              (meta.targetedAttribute ? [meta.targetedAttribute] : []),
            matchedAttributes: r.matchedAttributes || [],
            missingSignals: r.missingSignals || [],
            intentCoverageScore: score,
            visibility,
            statusMessage: visibilityMessage(visibility, promptText),
            recommendations: r.recommendations || [],
          }
        }),
      )
    } catch (err) {
      logger.warn(
        `Batch scoring failed, falling back to single: ${err.message}`,
      )
      for (const promptObj of chunkObjs) {
        try {
          const single = await scorePromptForProduct(
            promptObj.prompt,
            product,
            analysis,
          )
          const meta = promptObj
          if (meta.winProbability) {
            const visibility = winProbabilityToVisibility(meta.winProbability)
            single.visibility = visibility
            single.intentCoverageScore = clampScoreToBand(
              single.intentCoverageScore ?? 0,
              visibility,
            )
            single.statusMessage = visibilityMessage(visibility, single.prompt)
          }
          allScored.push(single)
        } catch (e) {
          logger.warn(`Failed to score "${promptObj.prompt}": ${e.message}`)
        }
      }
    }
  }

  // ── Upsert each scored prompt (unchanged from before) ───────────────
  for (const scored of allScored) {
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
