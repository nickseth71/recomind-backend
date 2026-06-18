import express from "express"
const router = express.Router()
import * as ctrl from "../controllers/report.controller.js"
import { authenticate, requireFeature } from "../middleware/auth.js"

router.use(authenticate)

router.get("/summary", ctrl.getSummary)
router.get(
  "/llms-txt",
  requireFeature("monthlyReportExport"),
  ctrl.generateLlmsTxt,
)
router.get("/audit-log", ctrl.getAuditLog)

export default router
