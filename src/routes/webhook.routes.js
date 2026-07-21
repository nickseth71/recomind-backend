import express from "express"
const router = express.Router()
import * as ctrl from "../controllers/webhook.controller.js"

// All webhook routes verify HMAC first
router.use(ctrl.verifyShopifyWebhook)

router.post("/products-create", ctrl.handleProductCreate)
router.post("/products-update", ctrl.handleProductUpdate)
router.post("/products-delete", ctrl.handleProductDelete)
router.post("/app-uninstalled", ctrl.handleAppUninstalled)
router.post("/markets-update", ctrl.handleMarketsUpdate)

export default router
