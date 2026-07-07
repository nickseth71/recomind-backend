import { Queue, Worker } from "bullmq"
import { getBullMQRedis } from "../config/redis.js"
import logger from "../config/logger.js"
import Store from "../models/store.model.js"
import Product from "../models/product.model.js"
import ProductAnalysis from "../models/product-analysis.mode.js"
import * as impactService from "../services/impact.service.js"

const QUEUE_NAME = "recomind-metrics-sync"

export default async function startMetricsSync() {
  const redis = getBullMQRedis()

  const queue = new Queue(QUEUE_NAME, {
    connection: redis,
    defaultJobOptions: { removeOnComplete: 5, removeOnFail: 10 },
  })

  // Schedule a nightly run (default 02:00 UTC) — configurable with METRICS_SYNC_CRON
  await queue.add(
    "metrics-sync",
    {},
    { repeat: { cron: process.env.METRICS_SYNC_CRON || "0 2 * * *" } },
  )

  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      logger.info("Starting metrics sync job")
      const stores = await Store.find({ isActive: true }).lean()
      for (const s of stores) {
        try {
          const store = await Store.findById(s._id)
          if (!store) continue

          const products = await Product.find({
            storeId: s._id,
            isOptimized: true,
          })
            .select("_id shopifyProductId title")
            .lean()

          const limit = parseInt(process.env.METRICS_SYNC_LIMIT || "200", 10)
          for (const p of products.slice(0, limit)) {
            try {
              const analysis = await ProductAnalysis.findOne({
                productId: p._id,
                appliedToShopify: true,
                appliedAt: { $ne: null },
              })
                .sort({ appliedAt: -1 })
                .select("appliedAt")
                .lean()
              if (!analysis?.appliedAt) continue

              await impactService.recordProductPostOptimization(
                store,
                p,
                analysis.appliedAt,
              )
            } catch (err) {
              logger.warn(
                `Could not refresh metrics for product ${p._id}: ${err.message}`,
              )
            }
          }

          store.lastSyncedAt = new Date()
          await store.save()
        } catch (err) {
          logger.warn(`Metrics sync failed for ${s.shopDomain}: ${err.message}`)
        }
      }
      logger.info("Metrics sync job complete")
      return { success: true }
    },
    { connection: redis, concurrency: 1 },
  )

  worker.on("failed", (job, err) => {
    logger.error(`Metrics sync worker failed: ${err.message}`)
  })

  logger.info("Metrics sync scheduled and worker started")
  return { queue, worker }
}
