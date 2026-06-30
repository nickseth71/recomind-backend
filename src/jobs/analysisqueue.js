import { Queue, Worker, QueueEvents } from "bullmq"
import { getBullMQRedis } from "../config/redis.js"
import logger from "../config/logger.js"
import * as aiService from "../services/ai.service.js"
import * as productSyncService from "../services/productsync.service.js"
import Product from "../models/product.model.js"
import ProductAnalysis from "../models/product-analysis.mode.js"
import AuditLog from "../models/auditlog.model.js"

const QUEUE_NAME = "recomind-ai-jobs"
const CONCURRENCY = parseInt(process.env.QUEUE_CONCURRENCY) || 3

let analysisQueue
let analysisWorker

function getQueue() {
  if (!analysisQueue) {
    analysisQueue = new Queue(QUEUE_NAME, {
      connection: getBullMQRedis(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 2000 },
        removeOnComplete: 100,
        removeOnFail: 50,
      },
    })
  }
  return analysisQueue
}

/**
 * Enqueue a single product analysis job.
 * Prevents duplicate jobs for the same product.
 */async function enqueueAnalysis(productId, storeId, priority = 10) {
  const queue = getQueue()

  logger.info(
    `[QUEUE] enqueueAnalysis() called for product=${productId} store=${storeId}`,
  )

  const job = await queue.add(
    "analyse-product",
    {
      productId: productId.toString(),
      storeId: storeId.toString(),
    },
    {
      jobId: `${storeId}:${productId}`, // prevents duplicates
      priority,
      delay: Number(process.env.QUEUE_JOB_DELAY_MS) || 500,
    },
  )

  logger.info(`[QUEUE] Job queued successfully: ${job.id}`)

  return job.id
}

/**
 * Enqueue multiple products for bulk analysis.
 */async function enqueueBulkAnalysis(productIds, storeId) {
  const queue = getQueue()

  const jobs = productIds.map((productId, index) => ({
    name: "analyse-product",
    data: {
      productId: productId.toString(),
      storeId: storeId.toString(),
    },
    opts: {
      jobId: `${storeId}:${productId}`,
      priority: 20,
      delay: index * (Number(process.env.QUEUE_JOB_DELAY_MS) || 500),
    },
  }))

  logger.info(`[QUEUE] Adding ${jobs.length} bulk jobs`)

  const added = await queue.addBulk(jobs)

  logger.info(`[QUEUE] Added ${added.length} jobs`)

  return added.map((job) => job.id)
}

/**
 * Start the worker that processes AI analysis jobs.
 * Call this in a separate process (npm run worker).
 */
// function startWorker() {
//   const { connectDB } = require("../config/db")
//   const { connectRedis, getBullMQRedis } = require("../config/redis")

//   async function boot() {
//     await connectDB()
//     await connectRedis()

//     analysisWorker = new Worker(
//       QUEUE_NAME,
//       async (job) => {
//         const { productId, storeId } = job.data
//         logger.info(`Processing job ${job.id}: analyse product ${productId}`)

//         const product = await Product.findById(productId)
//         if (!product) throw new Error(`Product ${productId} not found`)

//         // Run AI analysis
//         const result = await aiService.analyseProduct(product)

//         // Persist analysis
//         const analysis = await ProductAnalysis.create({
//           productId,
//           storeId,
//           productTitle: product.title,
//           images: product.images || [],
//           score: result.score,
//           scoreBreakdown: result.scoreBreakdown || {},
//           bestFor: result.bestFor || [],
//           intentKeywords: result.intentKeywords || [],
//           intentClusters: result.intentClusters || [],
//           missingSignals: result.missingSignals || [],
//           comparisonOpportunities: result.comparisonOpportunities || [],
//           trustSignals: result.trustSignals || [],
//           faq: result.faq || [],
//           optimizedTitle: result.optimizedTitle,
//           optimizedDescription: result.optimizedDescription,
//           engineCoverage: result.engineCoverage || {},
//           rawAiResponse: result.rawAiResponse,
//         })

//         // Update product score
//         await Product.findByIdAndUpdate(productId, {
//           analysisScore: result.score,
//           lastAnalysedAt: new Date(),
//         })

//         // Audit log
//         await AuditLog.create({
//           storeId,
//           action: "PRODUCT_ANALYSED",
//           entityType: "product",
//           entityId: productId,
//           metadata: { score: result.score, analysisId: analysis._id },
//           performedBy: "system",
//         })

//         return { analysisId: analysis._id.toString(), score: result.score }
//       },
//       {
//         connection: getBullMQRedis(),
//         concurrency: CONCURRENCY,
//       },
//     )

//     analysisWorker.on("completed", (job, result) => {
//       logger.info(`Job ${job.id} completed: score=${result.score}`)
//     })

//     analysisWorker.on("failed", (job, err) => {
//       logger.error(`Job ${job?.id} failed:`, err.message)
//     })

//     logger.info(`🔧 Worker started — concurrency: ${CONCURRENCY}`)
//   }

//   boot().catch((err) => {
//     logger.error("Worker boot failed:", err)
//     process.exit(1)
//   })
// }

/**
 * Get job status by ID.
 */
async function getJobStatus(jobId) {
  const queue = getQueue()
  const job = await queue.getJob(jobId)
  if (!job) return { status: "not_found" }
  const state = await job.getState()
  return {
    id: job.id,
    status: state,
    progress: job.progress,
    result: job.returnvalue,
    failReason: job.failedReason,
    createdAt: new Date(job.timestamp),
  }
}

export {
  getQueue,
  enqueueAnalysis,
  enqueueBulkAnalysis,
  //startWorker,
  getJobStatus,
}
