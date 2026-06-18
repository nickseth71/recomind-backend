import express from "express"
const router = express.Router()
import {
  getMe,
  registerStore,
  getStoreToken,
  updateStoreSettings,
  listPlans,
} from "../controllers/auth.controller.js"
import { authenticate, validateShop } from "../middleware/auth.js"

router.post("/", registerStore)
router.get("/plans", listPlans)
router.get("/me", authenticate, getMe)
router.patch("/me/settings", authenticate, updateStoreSettings)
router.get("/token", validateShop, getStoreToken)

export default router
