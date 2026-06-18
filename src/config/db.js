import mongoose from "mongoose"
import logger from "./logger.js"

async function connectDB() {
  const uri = process.env.MONGODB_URI
  if (!uri) throw new Error("MONGODB_URI is not set in environment variables")

  mongoose.connection.on("connected", () => logger.info("MongoDB connected"))
  mongoose.connection.on("error", (err) => logger.error("MongoDB error:", err))
  mongoose.connection.on("disconnected", () =>
    logger.warn("MongoDB disconnected"),
  )

  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
  })
}

export default connectDB
