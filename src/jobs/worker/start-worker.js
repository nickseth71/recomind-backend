// import { Worker, QueueEvents } from "bullmq"
// import { getBullMQRedis } from "../../config/redis.js"
// import logger from "../../config/logger.js"
// import * as aiService from "../../services/ai.service.js"
// import * as promptWinService from "../../services/promptwin.service.js"
// import { analyzeFaqState } from "../../services/faq.service.js"
// import Product from "../../models/product.model.js"
// import ProductAnalysis from "../../models/product-analysis.mode.js"
// import AuditLog from "../../models/auditlog.model.js"
// import Store from "../../models/store.model.js"
// import { TOKEN_COSTS } from "../../config/plans.js"
// import crypto from "crypto"
// import { getPromptLimits } from "../../config/plans.js"
// import startMetricsSync from "../metrics-sync.js"

// const QUEUE_NAME = "recomind-ai-jobs"
// const CONCURRENCY = parseInt(process.env.QUEUE_CONCURRENCY) || 3

// let worker

// function generateProductHash(product) {
//   const content = JSON.stringify({
//     title: product.title,
//     description: product.description || "",
//     tags: (product.tags || []).sort().join(","),
//     productType: product.productType || "",
//     vendor: product.vendor || "",
//     variantCount: (product.variants || []).length,
//     variants: (product.variants || [])
//       .map((v) => ({ title: v.title, price: v.price, sku: v.sku }))
//       .sort((a, b) => (a.sku || "").localeCompare(b.sku || "")),
//   })
//   return crypto.createHash("sha256").update(content).digest("hex")
// }

// export default async function startWorker() {
//   try {
//     const redis = getBullMQRedis()

//     worker = new Worker(
//       QUEUE_NAME,
//       async (job) => {
//         logger.info(`Processing job ${job.id}: ${job.name}`)
//         const { productId, storeId } = job.data

//         if (job.name === "analyse-product") {
//           return await processAnalysisJob(productId, storeId, job)
//         }

//         throw new Error(`Unknown job type: ${job.name}`)
//       },
//       { connection: redis, concurrency: CONCURRENCY },
//     )

//     const queueEvents = new QueueEvents(QUEUE_NAME, { connection: redis })

//     worker.on("completed", (job) => logger.info(`✓ Job ${job.id} completed`))
//     worker.on("failed", (job, err) =>
//       logger.error(`✗ Job ${job.id} failed:`, err.message),
//     )
//     queueEvents.on("progress", (job) => {
//       if (job?.progress)
//         logger.debug(`Job ${job.id} progress: ${job.progress}%`)
//     })

//     logger.info(
//       `🚀 RecoMind Worker started – queue "${QUEUE_NAME}" concurrency=${CONCURRENCY}`,
//     )
//     // Start background metrics sync (recurring nightly job)
//     try {
//       await startMetricsSync()
//     } catch (err) {
//       logger.warn("Could not start metrics sync:", err.message)
//     }
//     return worker
//   } catch (err) {
//     logger.error("Worker startup failed:", err)
//     process.exit(1)
//   }
// }

// async function processAnalysisJob(productId, storeId, job) {
//   try {
//     const product = await Product.findOne({ _id: productId, storeId })
//     if (!product) throw new Error(`Product ${productId} not found`)

//     logger.info(`[Stage 1→3] Analysing: ${product.title}`)
//     job.updateProgress(10)

//     // ── Run full 3-stage AI pipeline ─────────────────────────────────
//     // analyseProduct() internally calls interpretProduct() (Stage 1)
//     // and generateSmartPrompts() (Stage 3), then runs Stage 2.
//     // The returned object contains: result + result.interpretation + result.smartPrompts
//     const result = await aiService.analyseProduct(product, storeId)
//     job.updateProgress(60)

//     // ── FAQ analysis fallback ─────────────────────────────────────────
//     const faqAnalysis =
//       result.faqAnalysis ||
//       analyzeFaqState(product.existingFaqs, result.faq, result.scoreBreakdown)

//     const store = await Store.findById(storeId)
//     const planLimits = getPromptLimits(store.plan, store.addons || {})
//     const competitorBenchmark = aiService.buildCompetitorBenchmark(
//       planLimits.competitorCount,
//       product,
//       result.interpretation,
//       result.score,
//     )

//     // ── Persist analysis ──────────────────────────────────────────────
//     const analysis = await ProductAnalysis.create({
//       productId: product._id,
//       productTitle: product.title,
//       storeId,
//       images: product.images || [],

//       // Scores
//       score: result.score,
//       scoreBreakdown: result.scoreBreakdown || {},

//       // Stage 1 — Product Interpretation
//       interpretation: result.interpretation || {},

//       // Stage 3 — Smart Prompts
//       smartPrompts: result.smartPrompts || {},

//       // Stage 2 enrichments
//       bestFor: result.bestFor || [],
//       intentKeywords: result.intentKeywords || [],
//       intentClusters: result.intentClusters || [],
//       missingSignals: result.missingSignals || [],
//       comparisonOpportunities: result.comparisonOpportunities || [],
//       trustSignals: result.trustSignals || [],
//       reasoning: result.reasoning || "",
//       prioritizedFixes: result.prioritizedFixes || [],

//       // FAQ
//       existingFaqs: result.existingFaqs || product.existingFaqs || [],
//       faq: result.faq || [],
//       faqAnalysis,

//       // Competitor benchmark
//       competitorBenchmark,

//       // Optimized content
//       optimizedTitle: result.optimizedTitle,
//       optimizedDescription: result.optimizedDescription,

//       // Engine coverage
//       engineCoverage: result.engineCoverage || {},

//       // Raw response for debugging
//       rawAiResponse: result.rawAiResponse,
//       marketContext: result.marketContext || null,
//     })

//     job.updateProgress(75)

//     // ── Update product record ─────────────────────────────────────────
//     const productHash = generateProductHash(product)
//     await Product.findByIdAndUpdate(productId, {
//       analysisScore: result.score,
//       lastAnalysedAt: new Date(),
//       lastAnalysedProductHash: productHash,
//       productCategory:
//         result.interpretation?.productIdentity?.productCategory || undefined,
//       primaryBuyer:
//         result.interpretation?.audienceProfile?.primaryBuyer || undefined,
//       autoPromptsCount: result.smartPrompts?.prompts?.length || 0,
//       analyzationCount: (product.analyzationCount || 0) + 1,
//     })

//     // ── Auto-generate Prompt Win scores ───────────────────────────────
//     // Now uses smartPrompts from the analysis instead of generating new ones,
//     // so promptWinService should accept pre-generated prompts when available.
//     // const store = await Store.findById(storeId)

//     store.usage.productsAnalyzed += 1
//     store.usage.autoPromptsGenerated +=
//       result.smartPrompts?.prompts?.length || 0
//     await store.save({ validateBeforeSave: false })

//     if (store?.hasFeature("promptWinDashboard")) {
//       try {
//         const preGeneratedPrompts = result.smartPrompts?.prompts || []
//         await promptWinService.generateAndScorePrompts(
//           productId,
//           storeId,
//           store,
//           {
//             // Pass the smart prompts already generated so the service
//             // skips the generation step and goes straight to scoring.
//             prompts: preGeneratedPrompts.length
//               ? preGeneratedPrompts
//               : undefined,
//             // Pass interpretation so scorePromptVisibility has full context
//             existingAnalysis: {
//               ...result,
//               interpretation: result.interpretation,
//             },
//           },
//         )
//         logger.info(`✓ Prompt win scores generated for ${product.title}`)
//       } catch (err) {
//         logger.warn(`Prompt generation skipped: ${err.message}`)
//       }
//     }

//     job.updateProgress(90)

//     // ── Audit log ─────────────────────────────────────────────────────
//     await AuditLog.create({
//       storeId,
//       action: "PRODUCT_ANALYSED",
//       entityType: "product",
//       entityId: productId,
//       metadata: {
//         score: result.score,
//         analysisId: analysis._id,
//         faqAction: faqAnalysis.action,
//         // Log interpretation confidence so you can monitor quality
//         interpretationConfidence:
//           result.interpretation?.productIdentity?.confidence || "UNKNOWN",
//       },
//       performedBy: "system",
//     })

//     // ── Token deduction ───────────────────────────────────────────────
//     if (store) {
//       try {
//         await store.deductTokens(TOKEN_COSTS.productAnalysis)
//         logger.info(
//           `✓ Deducted ${TOKEN_COSTS.productAnalysis} tokens from ${store.shopDomain}`,
//         )
//       } catch (err) {
//         logger.warn(`Could not deduct tokens: ${err.message}`)
//       }
//     }

//     job.updateProgress(100)
//     logger.info(
//       `✓ Analysis complete: ${product.title} (score: ${result.score})`,
//     )

//     return {
//       success: true,
//       analysisId: analysis._id,
//       score: result.score,
//       interpretationConfidence:
//         result.interpretation?.productIdentity?.confidence,
//     }
//   } catch (err) {
//     logger.error(`Analysis job failed for product ${productId}:`, err.message)
//     throw err
//   }
// }

import { Worker, QueueEvents } from "bullmq"
import { getBullMQRedis } from "../../config/redis.js"
import logger from "../../config/logger.js"
import * as aiService from "../../services/ai.service.js"
import * as promptWinService from "../../services/promptwin.service.js"
import { analyzeFaqState } from "../../services/faq.service.js"
import Product from "../../models/product.model.js"
import ProductAnalysis from "../../models/product-analysis.mode.js"
import AuditLog from "../../models/auditlog.model.js"
import Store from "../../models/store.model.js"
import { TOKEN_COSTS } from "../../config/plans.js"
import crypto from "crypto"
import { getPromptLimits } from "../../config/plans.js"
import startMetricsSync from "../metrics-sync.js"

const QUEUE_NAME = "recomind-ai-jobs"
const CONCURRENCY = parseInt(process.env.QUEUE_CONCURRENCY) || 3

let worker

// Keep in sync with ProductAnalysis schema's faqAnalysis enum values.
// The AI is instructed to only return these, but LLM output isn't fully
// deterministic — this maps any near-miss (e.g. "add" instead of "create")
// to the closest valid value instead of letting a Mongoose validation
// error fail the whole job.
const VALID_FAQ_ACTIONS = ["none", "create", "update", "review"]
const FAQ_ACTION_ALIASES = {
  add: "create",
  generate: "create",
  write: "create",
  new: "create",
  edit: "update",
  revise: "update",
  improve: "update",
  check: "review",
  verify: "review",
  audit: "review",
}
const VALID_FAQ_STRATEGIES = ["inline", "metafield", "skip"]

function normalizeFaqAnalysis(faqAnalysis = {}) {
  const rawAction = String(faqAnalysis.action || "none").toLowerCase()
  const action = VALID_FAQ_ACTIONS.includes(rawAction)
    ? rawAction
    : FAQ_ACTION_ALIASES[rawAction] || "none"

  const rawStrategy = String(
    faqAnalysis.recommendedStrategy || "inline",
  ).toLowerCase()
  const recommendedStrategy = VALID_FAQ_STRATEGIES.includes(rawStrategy)
    ? rawStrategy
    : "inline"

  if (action !== rawAction || recommendedStrategy !== rawStrategy) {
    logger.warn(
      `Normalized faqAnalysis enum values — action: "${rawAction}" -> "${action}", recommendedStrategy: "${rawStrategy}" -> "${recommendedStrategy}"`,
    )
  }

  return { ...faqAnalysis, action, recommendedStrategy }
}

function generateProductHash(product) {
  const content = JSON.stringify({
    title: product.title,
    description: product.description || "",
    tags: (product.tags || []).sort().join(","),
    productType: product.productType || "",
    vendor: product.vendor || "",
    variantCount: (product.variants || []).length,
    variants: (product.variants || [])
      .map((v) => ({ title: v.title, price: v.price, sku: v.sku }))
      .sort((a, b) => (a.sku || "").localeCompare(b.sku || "")),
  })
  return crypto.createHash("sha256").update(content).digest("hex")
}

export default async function startWorker() {
  try {
    const redis = getBullMQRedis()

    worker = new Worker(
      QUEUE_NAME,
      async (job) => {
        logger.info(`Processing job ${job.id}: ${job.name}`)
        const { productId, storeId } = job.data

        if (job.name === "analyse-product") {
          return await processAnalysisJob(productId, storeId, job)
        }

        throw new Error(`Unknown job type: ${job.name}`)
      },
      { connection: redis, concurrency: CONCURRENCY },
    )

    const queueEvents = new QueueEvents(QUEUE_NAME, { connection: redis })

    worker.on("completed", (job) => logger.info(`✓ Job ${job.id} completed`))
    worker.on("failed", (job, err) =>
      logger.error(`✗ Job ${job.id} failed:`, err.message),
    )
    queueEvents.on("progress", (job) => {
      if (job?.progress)
        logger.debug(`Job ${job.id} progress: ${job.progress}%`)
    })

    logger.info(
      `🚀 RecoMind Worker started – queue "${QUEUE_NAME}" concurrency=${CONCURRENCY}`,
    )
    // Start background metrics sync (recurring nightly job)
    try {
      await startMetricsSync()
    } catch (err) {
      logger.warn("Could not start metrics sync:", err.message)
    }
    return worker
  } catch (err) {
    logger.error("Worker startup failed:", err)
    process.exit(1)
  }
}

async function processAnalysisJob(productId, storeId, job) {
  try {
    const product = await Product.findOne({ _id: productId, storeId })
    if (!product) throw new Error(`Product ${productId} not found`)

    logger.info(`[Stage 1→3] Analysing: ${product.title}`)
    job.updateProgress(10)

    // ── Run full 3-stage AI pipeline ─────────────────────────────────
    // analyseProduct() internally calls interpretProduct() (Stage 1)
    // and generateSmartPrompts() (Stage 3), then runs Stage 2.
    // The returned object contains: result + result.interpretation + result.smartPrompts
    const result = await aiService.analyseProduct(product, storeId)
    job.updateProgress(60)

    // ── FAQ analysis fallback ─────────────────────────────────────────
    const rawFaqAnalysis =
      result.faqAnalysis ||
      analyzeFaqState(product.existingFaqs, result.faq, result.scoreBreakdown)
    const faqAnalysis = normalizeFaqAnalysis(rawFaqAnalysis)

    const store = await Store.findById(storeId)
    const planLimits = getPromptLimits(store.plan, store.addons || {})
    const competitorBenchmark = aiService.buildCompetitorBenchmark(
      planLimits.competitorCount,
      product,
      result.interpretation,
      result.score,
    )

    // ── Persist analysis ──────────────────────────────────────────────
    const analysis = await ProductAnalysis.create({
      productId: product._id,
      productTitle: product.title,
      storeId,
      images: product.images || [],

      // Scores
      score: result.score,
      scoreBreakdown: result.scoreBreakdown || {},

      // Stage 1 — Product Interpretation
      interpretation: result.interpretation || {},

      // Stage 3 — Smart Prompts
      smartPrompts: result.smartPrompts || {},

      // Stage 2 enrichments
      bestFor: result.bestFor || [],
      intentKeywords: result.intentKeywords || [],
      intentClusters: result.intentClusters || [],
      missingSignals: result.missingSignals || [],
      comparisonOpportunities: result.comparisonOpportunities || [],
      trustSignals: result.trustSignals || [],
      reasoning: result.reasoning || "",
      prioritizedFixes: result.prioritizedFixes || [],

      // FAQ
      existingFaqs: result.existingFaqs || product.existingFaqs || [],
      faq: result.faq || [],
      faqAnalysis,

      // Competitor benchmark
      competitorBenchmark,

      // Optimized content
      optimizedTitle: result.optimizedTitle,
      optimizedDescription: result.optimizedDescription,

      // Category-aware attribute detection
      categoryAttributeChecklist: result.categoryAttributeChecklist || null,

      // Engine coverage
      engineCoverage: result.engineCoverage || {},

      // Raw response for debugging
      rawAiResponse: result.rawAiResponse,
      marketContext: result.marketContext || null,
    })

    job.updateProgress(75)

    // ── Update product record ─────────────────────────────────────────
    const productHash = generateProductHash(product)
    await Product.findByIdAndUpdate(productId, {
      analysisScore: result.score,
      lastAnalysedAt: new Date(),
      lastAnalysedProductHash: productHash,
      productCategory:
        result.interpretation?.productIdentity?.productCategory || undefined,
      primaryBuyer:
        result.interpretation?.audienceProfile?.primaryBuyer || undefined,
      autoPromptsCount: result.smartPrompts?.prompts?.length || 0,
    })

    await Product.findByIdAndUpdate(productId, {
      $inc: { analyzationCount: 1 },
    })

    // ── Auto-generate Prompt Win scores ───────────────────────────────
    // Now uses smartPrompts from the analysis instead of generating new ones,
    // so promptWinService should accept pre-generated prompts when available.
    // const store = await Store.findById(storeId)

    // Atomic — same reasoning as store.deductTokens(): this function can run
    // as one of several concurrent worker jobs for the same store, so a
    // plain load-mutate-save here would lose increments the same way token
    // deduction did.
    const promptsGenerated = result.smartPrompts?.prompts?.length || 0
    await Store.findByIdAndUpdate(storeId, {
      $inc: {
        "usage.productsAnalyzed": 1,
        "usage.autoPromptsGenerated": promptsGenerated,
      },
    })

    if (store?.hasFeature("promptWinDashboard")) {
      try {
        const preGeneratedPrompts = result.smartPrompts?.prompts || []
        await promptWinService.generateAndScorePrompts(
          productId,
          storeId,
          store,
          {
            // Pass the smart prompts already generated so the service
            // skips the generation step and goes straight to scoring.
            prompts: preGeneratedPrompts.length
              ? preGeneratedPrompts
              : undefined,
            // Pass interpretation so scorePromptVisibility has full context
            existingAnalysis: {
              ...result,
              interpretation: result.interpretation,
            },
          },
        )
        logger.info(`✓ Prompt win scores generated for ${product.title}`)
      } catch (err) {
        logger.warn(`Prompt generation skipped: ${err.message}`)
      }
    }

    job.updateProgress(90)

    // ── Audit log ─────────────────────────────────────────────────────
    await AuditLog.create({
      storeId,
      action: "PRODUCT_ANALYSED",
      entityType: "product",
      entityId: productId,
      metadata: {
        score: result.score,
        analysisId: analysis._id,
        faqAction: faqAnalysis.action,
        // Log interpretation confidence so you can monitor quality
        interpretationConfidence:
          result.interpretation?.productIdentity?.confidence || "UNKNOWN",
      },
      performedBy: "system",
    })

    // ── Token deduction ───────────────────────────────────────────────
    if (store) {
      try {
        await store.deductTokens(TOKEN_COSTS.productAnalysis)
        logger.info(
          `✓ Deducted ${TOKEN_COSTS.productAnalysis} tokens from ${store.shopDomain}`,
        )
      } catch (err) {
        logger.warn(`Could not deduct tokens: ${err.message}`)
      }
    }

    job.updateProgress(100)
    logger.info(
      `✓ Analysis complete: ${product.title} (score: ${result.score})`,
    )

    return {
      success: true,
      analysisId: analysis._id,
      score: result.score,
      interpretationConfidence:
        result.interpretation?.productIdentity?.confidence,
    }
  } catch (err) {
    logger.error(`Analysis job failed for product ${productId}:`, err.message)
    throw err
  }
}
