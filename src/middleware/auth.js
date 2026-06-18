import jwt from "jsonwebtoken"
import Store from "../models/store.model.js"
import { getRedis } from "../config/redis.js"

async function authenticate(req, res, next) {
  try {
    const header = req.headers.authorization
    if (!header?.startsWith("Bearer ")) {
      return res
        .status(401)
        .json({ success: false, error: "Missing Authorization header" })
    }

    const token = header.split(" ")[1]

    // Check revocation list
    const redis = getRedis()
    const revoked = await redis.get(`revoked:${token}`).catch(() => null)
    if (revoked) {
      return res.status(401).json({ success: false, error: "Token revoked" })
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET)
    const store = await Store.findById(decoded.storeId)

    if (!store || !store.isActive) {
      return res
        .status(401)
        .json({ success: false, error: "Store not found or inactive" })
    }

    req.store = store
    req.token = token
    next()
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      return res.status(401).json({ success: false, error: "Token expired" })
    }
    return res.status(401).json({ success: false, error: "Invalid token" })
  }
}

function requireFeature(feature) {
  return (req, res, next) => {
    if (!req.store.hasFeature(feature)) {
      return res.status(403).json({
        success: false,
        error: "This feature requires a higher plan",
        requiredFeature: feature,
        currentPlan: req.store.plan,
      })
    }
    next()
  }
}

function requireAdmin(req, res, next) {
  const key = req.headers["x-admin-key"]
  if (!key || key !== process.env.ADMIN_SECRET_KEY) {
    return res
      .status(403)
      .json({ success: false, error: "Admin access required" })
  }
  next()
}

function signToken(storeId, shopDomain) {
  return jwt.sign(
    { storeId: storeId.toString(), shopDomain },
    process.env.JWT_SECRET,
    {
      expiresIn: process.env.JWT_EXPIRES_IN || "7d",
    },
  )
}

async function validateShop(req, res, next) {
  const { shop } = req.query

  if (!shop) {
    return res.status(400).json({
      success: false,
      error: "shop query param required",
    })
  }

  req.shop = shop
  next()
}

export { authenticate, requireFeature, requireAdmin, signToken, validateShop }
