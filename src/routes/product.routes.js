import express from "express"
const router = express.Router()
import * as ctrl from "../controllers/product.controller.js"
import { authenticate } from "../middleware/auth.js"
import {
  enforceProductAnalysisLimit,
  enforceProductSyncLimit,
} from "../middleware/plan-limits.js"
import {
  singleAnalyseGuard,
  bulkAnalyseGuard,
  loadBulkTargets,
  filterBulkReanalysisTargets,
} from "../middleware/guards.js"
import { aiLimiter } from "../middleware/rate-limiter.js"

router.use(authenticate)

router.get("/dashboard", ctrl.getDashboardStats)
router.get("/", ctrl.listProducts)
router.get("/shopify-search", ctrl.searchShopifyProducts)
router.post("/sync-selected", enforceProductSyncLimit(), ctrl.syncSelected)
router.post("/sync", ctrl.syncProducts)
router.post(
  "/analyse-bulk",
  aiLimiter,
  loadBulkTargets,
  filterBulkReanalysisTargets,
  bulkAnalyseGuard,
  ctrl.analyseBulk,
)
router.get("/jobs/:jobId", ctrl.checkJobStatus)
router.get("/:id", ctrl.getProduct)
router.post("/:id/analyse", aiLimiter, singleAnalyseGuard, ctrl.analyseProduct)
router.get("/:id/analysis", ctrl.getAnalyses)
router.get("/:id/competitors", ctrl.getCompetitorBenchmark)
router.post("/:id/optimise", ctrl.optimiseProduct)
router.post("/:id/rollback", ctrl.rollbackProduct)
router.delete("/:id/sync", ctrl.removeFromSync)

export default router
