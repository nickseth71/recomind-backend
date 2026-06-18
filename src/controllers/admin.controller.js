import Store from "../models/store.model.js"
import Product from "../models/product.model.js"
import ProductAnalysis from "../models/product-analysis.mode.js"
import PromptSimulation from "../models/promptsimulation.model.js"
import AuditLog from "../models/auditlog.model.js"
import { getRedis } from "../config/redis.js"
import { getQueue } from "../jobs/analysisqueue.js"

/**
 * GET /api/admin/stats
 * Platform-wide statistics for the admin panel.
 */
async function getPlatformStats(req, res, next) {
  try {
    const [
      totalStores,
      activeStores,
      planBreakdown,
      totalProducts,
      totalAnalyses,
      totalSimulations,
      recentInstalls,
    ] = await Promise.all([
      Store.countDocuments(),
      Store.countDocuments({ isActive: true }),
      Store.aggregate([{ $group: { _id: "$plan", count: { $sum: 1 } } }]),
      Product.countDocuments(),
      ProductAnalysis.countDocuments(),
      PromptSimulation.countDocuments(),
      Store.find({ isActive: true })
        .sort({ installedAt: -1 })
        .limit(10)
        .select("shopDomain shopName plan installedAt totalProductsSynced")
        .lean(),
    ])

    // Queue stats
    let queueStats = {}
    try {
      const queue = getQueue()
      const [waiting, active, completed, failed] = await Promise.all([
        queue.getWaitingCount(),
        queue.getActiveCount(),
        queue.getCompletedCount(),
        queue.getFailedCount(),
      ])
      queueStats = { waiting, active, completed, failed }
    } catch {
      queueStats = { error: "Queue unavailable" }
    }

    res.json({
      success: true,
      data: {
        stores: {
          total: totalStores,
          active: activeStores,
          byPlan: planBreakdown,
        },
        products: { total: totalProducts },
        analyses: { total: totalAnalyses },
        simulations: { total: totalSimulations },
        recentInstalls,
        queue: queueStats,
        generatedAt: new Date().toISOString(),
      },
    })
  } catch (err) {
    next(err)
  }
}

/**
 * GET /api/admin/stores
 * List all stores with search/filter.
 */
async function listStores(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1)
    const limit = Math.min(100, parseInt(req.query.limit) || 20)
    const skip = (page - 1) * limit

    const filter = {}
    if (req.query.plan) filter.plan = req.query.plan
    if (req.query.active !== undefined)
      filter.isActive = req.query.active === "true"
    if (req.query.search) {
      filter.$or = [
        { shopDomain: { $regex: req.query.search, $options: "i" } },
        { shopName: { $regex: req.query.search, $options: "i" } },
      ]
    }

    const [stores, total] = await Promise.all([
      Store.find(filter)
        .select("-accessTokenEncrypted")
        .sort({ installedAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Store.countDocuments(filter),
    ])

    res.json({
      success: true,
      data: stores,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    })
  } catch (err) {
    next(err)
  }
}

/**
 * PATCH /api/admin/stores/:id/plan
 * Update a store's plan.
 */
async function updateStorePlan(req, res, next) {
  try {
    const { plan, planExpiresAt, addons } = req.body
    const validPlans = ["starter", "growth", "pro", "agency"]
    if (!validPlans.includes(plan)) {
      return res.status(400).json({ success: false, error: "Invalid plan" })
    }

    const existing = await Store.findById(req.params.id)
    if (!existing)
      return res.status(404).json({ success: false, error: "Store not found" })

    existing.plan = plan === "agency" ? "pro" : plan
    existing.planExpiresAt = planExpiresAt || null
    if (addons) {
      if (typeof addons.promptTracking === "boolean") {
        existing.addons.promptTracking = addons.promptTracking
      }
      if (typeof addons.aiVisibilityAudit === "boolean") {
        existing.addons.aiVisibilityAudit = addons.aiVisibilityAudit
        if (addons.aiVisibilityAudit) {
          existing.addons.aiVisibilityAuditAt = new Date()
        }
      }
    }
    existing.monthlyTokenQuota = existing.getTokenQuotaForPlan()
    await existing.save()

    const store = await Store.findById(req.params.id).select(
      "-accessTokenEncrypted",
    )

    if (!store)
      return res.status(404).json({ success: false, error: "Store not found" })

    await AuditLog.create({
      storeId: store._id,
      action: "PLAN_CHANGED",
      entityType: "store",
      entityId: store._id,
      metadata: { newPlan: existing.plan, planExpiresAt, addons },
      performedBy: "admin",
    })

    res.json({ success: true, data: store })
  } catch (err) {
    next(err)
  }
}

/**
 * GET /api/admin/audit-log
 * Platform-wide audit log.
 */
async function getGlobalAuditLog(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1)
    const limit = Math.min(100, parseInt(req.query.limit) || 30)
    const skip = (page - 1) * limit

    const filter = {}
    if (req.query.action) filter.action = req.query.action
    if (req.query.storeId) filter.storeId = req.query.storeId

    const [logs, total] = await Promise.all([
      AuditLog.find(filter)
        .populate("storeId", "shopDomain shopName")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      AuditLog.countDocuments(filter),
    ])

    res.json({
      success: true,
      data: logs,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    })
  } catch (err) {
    next(err)
  }
}

export { getPlatformStats, listStores, updateStorePlan, getGlobalAuditLog }
