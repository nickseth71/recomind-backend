import "./config/dotenv.js"
import express from "express"
import cors from "cors"
import helmet from "helmet"
import morgan from "morgan"
import connectDB from "./config/db.js"
import { connectRedis } from "./config/redis.js"
import logger from "./config/logger.js"
import swaggerSetup from "./config/swagger.js"

import errorHandler from "./middleware/error-handler.js"
import { generalLimiter } from "./middleware/rate-limiter.js"

import authRoutes from "./routes/auth.routes.js"
import productRoutes from "./routes/product.routes.js"
import promptRoutes from "./routes/prompt.routes.js"
import reportRoutes from "./routes/report.routes.js"
import webhookRoutes from "./routes/webhook.routes.js"
import adminRoutes from "./routes/admin.routes.js"

const app = express()
app.set("trust proxy", 1)

// Webhooks need raw body — before express.json()
app.use(
  "/api/webhooks",
  express.raw({ type: "application/json" }),
  webhookRoutes,
)

app.use(helmet({ contentSecurityPolicy: false }))
app.use(
  cors(),
  //{
  //   //process.env.CORS_ORIGIN || "http://localhost:3000"
  //   origin: "*",
  //   optionsSuccessStatus: 200,
  // }
)
app.use(express.json({ limit: "2mb" }))
app.use(express.urlencoded({ extended: true }))
app.use(
  morgan("combined", { stream: { write: (msg) => logger.http(msg.trim()) } }),
)
app.use(generalLimiter)

swaggerSetup(app)

app.use("/recomind/v1/stores", authRoutes) // POST /v1/stores  ← called by afterAuth
app.use("/recomind/v1/products", productRoutes)
app.use("/recomind/v1/prompts", promptRoutes)
app.use("/recomind/v1/reports", reportRoutes)
app.use("/recomind/v1/admin", adminRoutes)

app.get("/v1/health", (req, res) => {
  res.json({ status: "ok", service: "RecoMind API", version: "1.0.0" })
})

app.use((req, res) =>
  res.status(404).json({ success: false, error: "Route not found" }),
)
app.use(errorHandler)

const PORT = process.env.PORT || 3000

async function maybeStartAnalysisWorker() {
  const autoStart =
    process.env.AUTO_START_WORKER === "true" ||
    (process.env.NODE_ENV !== "production" &&
      process.env.AUTO_START_WORKER !== "false")
  if (!autoStart) return

  const { default: startWorker } = await import("./jobs/worker/start-worker.js")
  await startWorker()
  logger.info("Analysis worker started (processing recomind-ai-jobs queue)")
}

async function start() {
  try {
    await connectDB()
    await connectRedis()
    await maybeStartAnalysisWorker()
    app.listen(PORT, () => {
      logger.info(
        `RecoMind API running on port ${PORT} [${process.env.NODE_ENV}]`,
      )
    })
  } catch (err) {
    logger.error("Fatal startup error:", err)
    process.exit(1)
  }
}

start()
export default app
