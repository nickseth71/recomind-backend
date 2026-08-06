#!/usr/bin/env node
import dotenv from "dotenv"
import path from "path"
import mongoose from "mongoose"
import axios from "axios"
import Store from "../src/models/store.model.js"

// Load .env
const envPath = process.env.BACKEND_ENV_PATH || path.join(process.cwd(), ".env")
dotenv.config({ path: envPath })

const shop = process.argv[2]
if (!shop) {
  console.error(
    "Usage: node scripts/recreate-store-webhooks.js your-shop.myshopify.com",
  )
  process.exit(1)
}

const topics = [
  "products/create",
  "products/update",
  "products/delete",
  "app/uninstalled",
  "markets/update",
]

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

    for (const topic of topics) {
      const address = `${process.env.APP_URL}/api/webhooks/${topic.replace("/", "-")}`
      console.log(`Registering ${topic} -> ${address}`)
      try {
        const res = await axios.post(
          `https://${shop}/admin/api/${process.env.SHOPIFY_API_VERSION || "2026-07"}/webhooks.json`,
          { webhook: { topic, address, format: "json" } },
          { headers: { "X-Shopify-Access-Token": token } },
        )
        console.log(`  status=${res.status}`)
        console.log(`  body=${JSON.stringify(res.data)}`)
      } catch (err) {
        console.error(
          `  error: ${err.response?.status} ${JSON.stringify(err.response?.data) || err.message}`,
        )
      }
    }

    await mongoose.disconnect()
  } catch (err) {
    console.error("Fatal:", err.message)
    process.exit(1)
  }
}

main()
