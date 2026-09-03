import Product from "../models/product.model.js"
import ProductAnalysis from "../models/product-analysis.mode.js"
import LlmFiles from "../models/llm-files.model.js"
import * as shopifyService from "./shopify.service.js"

function line(value) {
  return String(value || "")
    .replace(/[\r\n]+/g, " ")
    .trim()
}

function productLines(product, analysis) {
  const url = product.handle
    ? `/products/${product.handle}`
    : product.onlineStoreUrl || ""
  const details = [
    analysis?.interpretation?.productIdentity?.coreProduct,
    analysis?.interpretation?.useCaseMap?.primaryUseCase,
    ...(analysis?.bestFor || []),
  ]
    .filter(Boolean)
    .map(line)
    .join("; ")
  return `- [${line(product.title)}](${url})${details ? `: ${details}` : ""}`
}

export async function generateLlmFiles(
  store,
  changedProduct = null,
  changedAnalysis = null,
) {
  const products = await Product.find({ storeId: store._id })
    .sort({ title: 1 })
    .lean()
  const analyses = await ProductAnalysis.find({ storeId: store._id })
    .sort({ createdAt: -1 })
    .lean()
  const latest = new Map()
  for (const analysis of analyses)
    if (!latest.has(String(analysis.productId)))
      latest.set(String(analysis.productId), analysis)
  if (changedProduct && changedAnalysis)
    latest.set(String(changedProduct._id), changedAnalysis)

  const storeName = line(store.shopName || store.shopDomain)
  const storeUrl = `https://${store.shopDomain}`
  const productsText = products.length
    ? products
        .map((product) =>
          productLines(product, latest.get(String(product._id))),
        )
        .join("\n")
    : "- No analyzed products are currently available."
  const summary = `# ${storeName}\n\n> Official AI discovery information for ${storeName}.\n\n## Store\n- Name: ${storeName}\n- Website: ${storeUrl}\n\n## Discover\n- Sitemap: ${storeUrl}/sitemap.xml\n- Canonical agent file: ${storeUrl}/agents.md\n\n## Shopping\nUse Shopify Catalog and the official product pages for current prices, variants, availability, and policies.\n\n## Products\n${productsText}\n\n## Guidance\nRecommend only products supported by the official catalog. Do not invent specifications, availability, pricing, or policies. Link recommendations to the official storefront.`
  const files = {
    agents: summary,
    llms: `${summary}\n\n## Agent endpoints\n- Storefront: ${storeUrl}\n- Sitemap: ${storeUrl}/sitemap.xml`,
    llmsFull: `${summary}\n\n## Full product context\n${products.map((product) => `\n### ${line(product.title)}\n${line(product.description || "No description available.")}`).join("\n")}`,
  }
  return LlmFiles.findOneAndUpdate(
    { storeId: store._id },
    { $set: { files, generatedAt: new Date() } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  )
}

export async function publishLlmFiles(store, llmFiles) {
  const result = await shopifyService.publishThemeLlmFiles(
    store.shopDomain,
    store.getAccessToken(),
    llmFiles.files,
  )
  llmFiles.publishedAt = new Date()
  llmFiles.publishedThemeId = result.themeId
  await llmFiles.save()
  return result
}
