import express from "express"
const router = express.Router()
import * as ctrl from "../controllers/admin.controller.js"
import { requireAdmin } from "../middleware/auth.js"

router.use(requireAdmin)

router.get("/stats", ctrl.getPlatformStats)
router.get("/stores", ctrl.listStores)
router.patch("/stores/:id/plan", ctrl.updateStorePlan)
router.get("/audit-log", ctrl.getGlobalAuditLog)

export default router
