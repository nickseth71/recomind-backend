import express from "express"
const router = express.Router()
import {
  getMe,
  getVisibilityScore,
  registerStore,
  getStoreToken,
  syncStoreToken,
  updateStoreSettings,
  listPlans,
  getStoreBillingInfo,
  purchaseTokens,
  purchasePlan,
} from "../controllers/auth.controller.js"
import { authenticate, validateShop } from "../middleware/auth.js"

router.post("/", registerStore)
router.post("/sync-token", syncStoreToken)
router.get("/plans", listPlans)
router.get("/me", authenticate, getMe)
router.get("/visibility-score", authenticate, getVisibilityScore)
router.get("/billing", authenticate, getStoreBillingInfo)
router.post("/billing/tokens", authenticate, purchaseTokens)
router.post("/billing/plan", authenticate, purchasePlan)
router.patch("/me/settings", authenticate, updateStoreSettings)
router.get("/token", validateShop, getStoreToken)

export default router
