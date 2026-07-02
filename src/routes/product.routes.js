import express from "express"
const router = express.Router()
import * as ctrl from "../controllers/product.controller.js"
import { authenticate } from "../middleware/auth.js"
import { enforceProductAnalysisLimit } from "../middleware/plan-limits.js"
import { aiLimiter } from "../middleware/rate-limiter.js"

router.use(authenticate)

router.get("/dashboard", ctrl.getDashboardStats)
router.get("/", ctrl.listProducts)
router.post("/sync", ctrl.syncProducts)
router.post("/analyse-bulk", aiLimiter, ctrl.analyseBulk)
router.get("/jobs/:jobId", ctrl.checkJobStatus)
router.get("/:id", ctrl.getProduct)
router.post(
  "/:id/analyse",
  aiLimiter,
  enforceProductAnalysisLimit(),
  ctrl.analyseProduct,
)
router.get("/:id/analysis", ctrl.getAnalyses)
router.get("/:id/competitors", ctrl.getCompetitorBenchmark)
router.post("/:id/optimise", ctrl.optimiseProduct)
router.post("/:id/rollback", ctrl.rollbackProduct)

export default router
