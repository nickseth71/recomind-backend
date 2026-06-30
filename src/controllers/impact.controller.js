import * as dashboardService from "../services/dashboard.service.js"

async function getImpact(req, res, next) {
  try {
    const productId =
      typeof req.query.productId === "string" && req.query.productId.trim()
        ? req.query.productId.trim()
        : undefined

    const windowDays =
      typeof req.query.windowDays !== "undefined"
        ? Number(req.query.windowDays)
        : undefined

    const data = await dashboardService.getImpactData(req.store, {
      productId,
      windowDays,
    })

    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
}

export { getImpact }