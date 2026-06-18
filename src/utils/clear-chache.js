import { getRedis } from "../config/redis.js"

async function clearDashboardCache() {
  const redis = getRedis()

  const keys = await redis.keys("dashboard:*")

  if (keys.length > 0) {
    await redis.del(keys)
    console.log(`Deleted ${keys.length} dashboard cache keys`)
  } else {
    console.log("No dashboard cache found")
  }

  process.exit(0)
}

clearDashboardCache()
