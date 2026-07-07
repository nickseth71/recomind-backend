import * as impactService from "../services/impact.service.js"
import logger from "../config/logger.js"

function getImpactErrorResponse(err) {
  if (err?.message?.includes("Shopify access token not available")) {
    return {
      status: 400,
      payload: {
        success: false,
        error:
          "Shopify connection required. Reinstall the app to grant analytics access.",
      },
    }
  }

  if (err?.statusCode === 401 || err?.message?.includes("invalid or expired")) {
    return {
      status: 401,
      payload: {
        success: false,
        error:
          "Shopify access token is invalid or expired. Reconnect the app to refresh analytics access.",
      },
    }
  }

  if (
    err?.statusCode === 403 ||
    err?.message?.includes("scope") ||
    err?.message?.includes("permissions")
  ) {
    return {
      status: 403,
      payload: {
        success: false,
        error:
          "Shopify analytics access is missing required permissions. Reinstall the app and grant analytics access.",
      },
    }
  }

  return null
}

/**
 * GET /impact/summary
 * Store-level before/after performance from Shopify + intent matching.
 */
async function getSummary(req, res, next) {
  try {
    const windowDays = req.query.windowDays || req.query.periodDays || 7
    const data = await impactService.getImpactSummary(req.store, { windowDays })
    res.json({ success: true, data })
  } catch (err) {
    const errorResponse = getImpactErrorResponse(err)
    if (errorResponse) {
      return res.status(errorResponse.status).json(errorResponse.payload)
    }
    logger.error("Impact summary error:", err)
    next(err)
  }
}

/**
 * GET /impact/products
 * Per-product before/after metrics.
 */
async function getProducts(req, res, next) {
  try {
    const windowDays = req.query.windowDays || 7
    const limit = req.query.limit || 20
    const data = await impactService.getProductImpact(req.store, {
      windowDays,
      limit,
    })
    res.json({ success: true, data })
  } catch (err) {
    const errorResponse = getImpactErrorResponse(err)
    if (errorResponse) {
      return res.status(errorResponse.status).json(errorResponse.payload)
    }
    next(err)
  }
}

/**
 * GET /impact/opportunities
 * Top intent/fix opportunities with Shopify performance gains.
 */
async function getOpportunities(req, res, next) {
  try {
    const windowDays = req.query.windowDays || 7
    const limit = req.query.limit || 10
    const data = await impactService.getTopOpportunities(req.store, {
      windowDays,
      limit,
    })
    res.json({ success: true, data })
  } catch (err) {
    const errorResponse = getImpactErrorResponse(err)
    if (errorResponse) {
      return res.status(errorResponse.status).json(errorResponse.payload)
    }
    next(err)
  }
}

/**
 * GET /impact
 * Combined payload for the Impact dashboard page.
 */
async function getDashboard(req, res, next) {
  try {
    const windowDays = req.query.windowDays || 7
    // console.log(req.store, "req.store")
    const [summary, products, opportunities] = await Promise.all([
      impactService.getImpactSummary(req.store, { windowDays }),
      impactService.getProductImpact(req.store, { windowDays, limit: 20 }),
      impactService.getTopOpportunities(req.store, { windowDays, limit: 10 }),
    ])

    res.json({
      success: true,
      data: {
        ...summary,
        productImpact: products.products,
        opportunities: opportunities.opportunities,
        windowDays: Number(windowDays) || 7,
      },
    })
  } catch (err) {
    const errorResponse = getImpactErrorResponse(err)
    if (errorResponse) {
      return res.status(errorResponse.status).json(errorResponse.payload)
    }
    next(err)
  }
}

export { getSummary, getProducts, getOpportunities, getDashboard }
