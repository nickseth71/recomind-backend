import express from "express"
const router = express.Router()
import {
  getMe,
  registerStore,
  getStoreToken,
  syncStoreToken,
  updateStoreSettings,
  listPlans,
  getStoreBillingInfo,
} from "../controllers/auth.controller.js"
import { authenticate, validateShop } from "../middleware/auth.js"

router.post("/", registerStore)
router.post("/sync-token", syncStoreToken)
router.get("/plans", listPlans)
router.get("/me", authenticate, getMe)
router.get("/billing", authenticate, getStoreBillingInfo)
router.patch("/me/settings", authenticate, updateStoreSettings)
router.get("/token", validateShop, getStoreToken)

export default router
