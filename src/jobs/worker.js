import "../config/dotenv.js"
import { connectRedis } from "../config/redis.js"
import { default as connectDB } from "../config/db.js"
import startWorker from "./worker/start-worker.js"

async function main() {
  try {
    // Initialize database connections
    await connectDB()
    await connectRedis()

    // Start the worker
    await startWorker()
  } catch (err) {
    console.error("Failed to start worker:", err)
    process.exit(1)
  }
}

main()
