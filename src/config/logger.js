// import { createLogger, format, transports } from "winston"
// import path from "path"

// const { combine, timestamp, printf, colorize, errors } = format

// const logFormat = printf(({ level, message, timestamp, stack }) => {
//   return `${timestamp} [${level}]: ${stack || message}`
// })

// const logger = createLogger({
//   level: process.env.LOG_LEVEL || "info",
//   format: combine(
//     timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
//     errors({ stack: true }),
//     logFormat,
//   ),
//   transports: [
//     new transports.Console({
//       format: combine(colorize(), timestamp({ format: "HH:mm:ss" }), logFormat),
//     }),
//     new transports.File({
//       filename: path.join("logs", "error.log"),
//       level: "error",
//       maxsize: 5 * 1024 * 1024, // 5MB
//       maxFiles: 5,
//     }),
//     new transports.File({
//       filename: path.join("logs", "combined.log"),
//       maxsize: 10 * 1024 * 1024, // 10MB
//       maxFiles: 10,
//     }),
//   ],
// })

// export default logger

import { createLogger, format, transports } from "winston"
import path from "path"

const { combine, timestamp, printf, colorize, errors } = format

const logFormat = printf(({ level, message, timestamp, stack, ...meta }) => {
  const splat = meta[Symbol.for("splat")]
  let extra = ""
  if (Array.isArray(splat) && splat.length) {
    extra =
      " " +
      splat
        .map((s) => {
          if (s instanceof Error) return s.stack || s.message
          if (typeof s === "object" && s !== null) {
            try {
              return JSON.stringify(s)
            } catch {
              return String(s)
            }
          }
          return String(s)
        })
        .join(" ")
  }
  return `${timestamp} [${level}]: ${stack || message}${extra}`
})

const logger = createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: combine(
    timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
    errors({ stack: true }),
    logFormat,
  ),
  transports: [
    new transports.Console({
      format: combine(colorize(), timestamp({ format: "HH:mm:ss" }), logFormat),
    }),
    new transports.File({
      filename: path.join("logs", "error.log"),
      level: "error",
      maxsize: 5 * 1024 * 1024, // 5MB
      maxFiles: 5,
    }),
    new transports.File({
      filename: path.join("logs", "combined.log"),
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 10,
    }),
  ],
})

export default logger