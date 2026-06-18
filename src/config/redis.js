import Redis from "ioredis"
import logger from "./logger.js"

let redisClient
let bullmqClient

async function connectRedis() {
  const url = process.env.REDIS_URL
  if (!url) throw new Error("REDIS_URL is not set in environment variables")

  // Main Redis client
  redisClient = new Redis(url, {
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: false,
  })

  redisClient.on("connect", () => logger.info("✅ Redis connected"))
  redisClient.on("error", (err) => logger.error("Redis error:", err.message))

  // Wait for connection
  await new Promise((resolve, reject) => {
    redisClient.on("connect", resolve)
    redisClient.on("error", reject)
  })

  // Create a separate connection for BullMQ with proper settings
  bullmqClient = new Redis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: false,
  })

  bullmqClient.on("error", (err) =>
    logger.error("BullMQ Redis error:", err.message),
  )

  // Wait for BullMQ connection
  await new Promise((resolve, reject) => {
    bullmqClient.on("connect", () => {
      logger.info("✅ BullMQ Redis connected")
      resolve()
    })
    bullmqClient.on("error", reject)
  })

  return redisClient
}

function getRedis() {
  if (!redisClient)
    throw new Error("Redis not initialised — call connectRedis() first")
  return redisClient
}

function getBullMQRedis() {
  if (!bullmqClient)
    throw new Error("BullMQ Redis not initialised — call connectRedis() first")
  return bullmqClient
}

export { connectRedis, getRedis, getBullMQRedis }
