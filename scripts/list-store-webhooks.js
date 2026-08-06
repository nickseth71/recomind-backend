#!/usr/bin/env node
import dotenv from "dotenv"
import path from "path"
import mongoose from "mongoose"
import axios from "axios"
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
    "Usage: node scripts/list-store-webhooks.js your-shop.myshopify.com",
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

    const token = store.accessToken
    if (!token) {
      console.error("No access token available for this store")
      process.exit(3)
    }

    const res = await axios.get(
      `https://${shop}/admin/api/${process.env.SHOPIFY_API_VERSION || "2026-07"}/webhooks.json`,
      { headers: { "X-Shopify-Access-Token": token } },
    )

    console.log(JSON.stringify(res.data, null, 2))
    await mongoose.disconnect()
  } catch (err) {
    console.error("Error:", err.response?.data || err.message)
    process.exit(1)
  }
}

main()
