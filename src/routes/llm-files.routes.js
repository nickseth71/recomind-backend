import express from "express"
import { authenticate } from "../middleware/auth.js"
import {
  getLlmFiles,
  regenerateLlmFiles,
  publishGeneratedLlmFiles,
} from "../controllers/llm-files.controller.js"

const router = express.Router()
router.use(authenticate)
router.get("/", getLlmFiles)
router.post("/generate", regenerateLlmFiles)
router.post("/publish", publishGeneratedLlmFiles)
export default router
