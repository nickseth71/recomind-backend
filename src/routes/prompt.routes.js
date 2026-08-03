import express from "express"
const router = express.Router()
import * as ctrl from "../controllers/prompt.controller.js"
import { authenticate, requireFeature } from "../middleware/auth.js"
import { aiLimiter } from "../middleware/rate-limiter.js"

router.use(authenticate)

router.get(
  "/win-dashboard",
  requireFeature("promptWinDashboard"),
  ctrl.getWinDashboard,
)

router.get(
  "/win-dashboard/prompts",
  requireFeature("promptWinDashboard"),
  ctrl.getWinDashboardPrompts,
)
router.get("/history", ctrl.getSimulationHistory)
router.post("/score", aiLimiter, ctrl.scorePrompt)
router.post(
  "/simulate",
  aiLimiter,
  requireFeature("simulate"),
  ctrl.simulatePrompt,
)
router.post(
  "/analyse",
  aiLimiter,
  requireFeature("promptIntelligence"),
  ctrl.analysePromptIntelligence,
)
router.get("/products/:productId", ctrl.getProductPrompts)
router.post(
  "/products/:productId/generate",
  aiLimiter,
  requireFeature("promptWinDashboard"),
  ctrl.generateProductPrompts,
)
router.get(
  "/:promptId",
  requireFeature("promptWinDashboard"),
  ctrl.getPromptDetails,
)
router.get("/:promptId/fix", requireFeature("fixForPrompt"), ctrl.getPromptFix)

export default router
