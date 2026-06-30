import express from "express"
import { authenticate } from "../middleware/auth.js"
import { getImpact } from "../controllers/dashboard.controller.js"

const router = express.Router()

router.use(authenticate)

/**
 * @openapi
 * /api/v1/dashboard/impact:
 *   get:
 *     tags:
 *       - Dashboard
 *     summary: Get AI optimization impact metrics
 *     description: >
 *       Returns store-level or product-level impact data for revenue and
 *       intents unlocked. Traffic and conversion rate are stubbed as not
 *       implemented in Phase 1.
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: productId
 *         schema:
 *           type: string
 *         description: Internal Product._id to scope this request to a single product
 *       - in: query
 *         name: windowDays
 *         schema:
 *           type: integer
 *           default: 30
 *         description: Number of days before/after the anchor to compare
 *     responses:
 *       '200':
 *         description: Impact dashboard response
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     anchor:
 *                       type: string
 *                       format: date-time
 *                       nullable: true
 *                     revenue:
 *                       type: object
 *                     intentsUnlocked:
 *                       type: object
 *                     traffic:
 *                       type: object
 *                     conversionRate:
 *                       type: object
 *       '400':
 *         description: Bad request
 *       '401':
 *         description: Unauthorized
 *       '404':
 *         description: Product not found
 */
router.get("/impact", getImpact)

export default router