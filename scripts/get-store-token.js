#!/usr/bin/env node
import dotenv from "dotenv"
import path from "path"
import mongoose from "mongoose"
import Store from "../src/models/store.model.js"

// Load .env robustly from the backend working directory
const envPath = process.env.BACKEND_ENV_PATH || path.join(process.cwd(), ".env")
dotenv.config({ path: envPath })

if (!process.env.MONGODB_URI) {
  console.error(
    `Missing MONGODB_URI in env (looked at ${envPath}). Set it and retry.`,
  )
  process.exit(1)
}

const shop = process.argv[2]
if (!shop) {
  console.error(
    "Usage: node scripts/get-store-token.js your-shop.myshopify.com",
  )
  process.exit(1)
}

async function main() {
  try {
    await mongoose.connect(process.env.MONGODB_URI)
    const store = await Store.findOne({ shopDomain: shop.toLowerCase().trim() })
    if (!store) {
      console.error(`Store not found: ${shop}`)
      process.exit(2)
    }

    console.log(store.accessToken)
    await mongoose.disconnect()
  } catch (err) {
    console.error("Error:", err.message)
    process.exit(1)
  }
}

main()
