import rateLimit from "express-rate-limit"

const windowMs = parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000
const max = parseInt(process.env.RATE_LIMIT_MAX) || 100

/** General API rate limiter */
const generalLimiter = rateLimit({
  windowMs,
  max,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: "Too many requests, please try again later",
  },
})

/** Stricter limiter for AI-heavy endpoints */
const aiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: "AI request rate limit reached. Please wait a moment.",
  },
})

/** Auth endpoint limiter */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: "Too many auth requests" },
})

export { generalLimiter, aiLimiter, authLimiter }
