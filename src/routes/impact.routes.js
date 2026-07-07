import express from "express"
import * as ctrl from "../controllers/impact.controller.js"
import { authenticate } from "../middleware/auth.js"

const router = express.Router()

router.use(authenticate)

router.get("/", ctrl.getDashboard)
router.get("/summary", ctrl.getSummary)
router.get("/products", ctrl.getProducts)
router.get("/opportunities", ctrl.getOpportunities)

export default router
