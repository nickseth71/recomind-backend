import logger from "../config/logger.js"

function errorHandler(err, req, res, next) {
  const status = err.statusCode || err.status || 500
  const message = err.message || "Internal server error"

  // Log server errors
  if (status >= 500) {
    logger.error(`[${req.method} ${req.path}] ${message}`, { stack: err.stack })
  } else {
    logger.warn(`[${req.method} ${req.path}] ${status}: ${message}`)
  }

  res.status(status).json({
    success: false,
    error: message,
    ...(process.env.NODE_ENV === "development" && { stack: err.stack }),
  })
}

export default errorHandler
