// import logger from "../config/logger.js"
// import Product from "../models/product.model.js"
// import Store from "../models/store.model.js"
// import * as shopifyService from "./shopify.service.js"
// import {
//   extractFaqsFromHtml,
//   hasFaqSectionInHtml,
//   removeFaqSectionFromHtml,
//   buildFaqHtml,
//   mergeFaqs,
//   resolveFaqStrategy,
//   buildOptimizedDescription,
// } from "./faq.service.js"

// function mapProductFields(raw, metafieldFaqs = [], extra = {}) {
//   const descriptionHtml = raw.body_html || ""
//   const inlineFaqs = extractFaqsFromHtml(descriptionHtml)
//   const hasInlineFaq =
//     hasFaqSectionInHtml(descriptionHtml) || inlineFaqs.length > 0

//   let existingFaqs = []
//   let faqSource = "none"

//   if (metafieldFaqs.length > 0) {
//     existingFaqs = metafieldFaqs
//     faqSource = "metafield"
//   } else if (inlineFaqs.length > 0) {
//     existingFaqs = inlineFaqs.map((f) => ({ ...f, source: "description" }))
//     faqSource = "description"
//   }

//   return {
//     title: raw.title,
//     description: descriptionHtml.replace(/<[^>]*>/g, "") || "",
//     descriptionHtml,
//     brand: raw.vendor || null,
//     tags: raw.tags
//       ? raw.tags
//           .split(",")
//           .map((t) => t.trim())
//           .filter(Boolean)
//       : [],
//     variants: (raw.variants || []).map((v) => ({
//       shopifyVariantId: String(v.id),
//       title: v.title,
//       price: v.price,
//       sku: v.sku,
//       inventory_quantity: v.inventory_quantity,
//       option1: v.option1,
//       option2: v.option2,
//       option3: v.option3,
//     })),
//     images: (raw.images || []).map((img) => img.src),
//     productType: raw.product_type,
//     vendor: raw.vendor,
//     collections: extra.collections || [],
//     reviews: extra.reviews || [],
//     metafields: extra.metafields || [],
//     handle: raw.handle,
//     status: raw.status,
//     existingFaqs,
//     faqSource,
//     hasFaqSection: hasInlineFaq,
//     shopifyCreatedAt: raw.created_at,
//     shopifyUpdatedAt: raw.updated_at,
//     syncedAt: new Date(),
//   }
// }

// /**
//  * Full sync: pull all products from Shopify and upsert into MongoDB.
//  */
// async function enrichProductFromShopify(store, raw) {
//   let metafieldFaqs = []
//   let metafields = []
//   let collections = []
//   let reviews = []

//   try {
//     metafields = await shopifyService.fetchProductMetafields(
//       store.shopDomain,
//       store.accessToken,
//       raw.id,
//     )
//     metafieldFaqs = shopifyService.parseFaqsFromMetafields(metafields)
//     reviews = shopifyService.parseReviewsFromMetafields(metafields)
//   } catch {
//     // metafield scope may not be granted
//   }

//   try {
//     collections = await shopifyService.fetchProductCollections(
//       store.shopDomain,
//       store.accessToken,
//       raw.id,
//     )
//   } catch {
//     // collections optional
//   }

//   // console.log(
//   //   "MAPPED METAFIELDS:",
//   //   JSON.stringify(shopifyService.mapProductMetafields(metafields), null, 2),
//   // )

//   return mapProductFields(raw, metafieldFaqs, {
//     collections,
//     reviews,
//     metafields: shopifyService.mapProductMetafields(metafields),
//   })
// }

// /**
//  * Full sync: pull all products from Shopify and upsert into MongoDB.
//  */
// async function syncAllProducts(storeId) {
//   const store = await Store.findById(storeId)
//   if (!store) throw new Error("Store not found")

//   const rawProducts = await shopifyService.fetchAllProducts(
//     store.shopDomain,
//     store.accessToken,
//   )

//   let synced = 0
//   for (const raw of rawProducts) {
//     const fields = await enrichProductFromShopify(store, raw)

//     await Product.findOneAndUpdate(
//       { storeId, shopifyProductId: String(raw.id) },
//       { storeId, shopifyProductId: String(raw.id), ...fields },
//       { upsert: true, new: true, setDefaultsOnInsert: true },
//     )
//     synced++
//   }

//   await Store.findByIdAndUpdate(storeId, {
//     totalProductsSynced: synced,
//     lastSyncedAt: new Date(),
//   })

//   logger.info(`Sync complete for store ${store.shopDomain}: ${synced} products`)
//   return synced
// }

// /**
//  * Sync a single product from Shopify (used after webhook).
//  */
// async function syncSingleProduct(storeId, shopifyProductId) {
//   const store = await Store.findById(storeId)
//   if (!store) throw new Error("Store not found")

//   const raw = await shopifyService.fetchProduct(
//     store.shopDomain,
//     store.accessToken,
//     shopifyProductId,
//   )

//   const fields = await enrichProductFromShopify(store, raw)

//   // console.log("METAFIELDS IS ARRAY:", Array.isArray(fields.metafields))

//   // console.log("FIRST METAFIELD:", fields.metafields?.[0])

//   return Product.findOneAndUpdate(
//     { storeId, shopifyProductId: String(raw.id) },
//     fields,
//     { upsert: true, new: true, setDefaultsOnInsert: true },
//   )
// }

// /**
//  * Apply optimised content back to Shopify product.
//  * FAQ handling:
//  *  - inline: update/create FAQ section in description (not duplicated in optimizedDescription)
//  *  - metafield: write to recomind.faqs metafield
//  *  - skip: don't touch FAQs
//  */
// async function applyOptimisationToShopify(
//   storeId,
//   shopifyProductId,
//   analysis,
//   options = {},
// ) {
//   const store = await Store.findById(storeId)
//   if (!store) throw new Error("Store not found")

//     //console.log("accessToken from updateProduct:", store.accessToken)

//   const product = await Product.findOne({
//     storeId,
//     shopifyProductId: String(shopifyProductId),
//   })
//   const faqStrategy = resolveFaqStrategy(
//     product || {},
//     store,
//     options.faqStrategy,
//   )

//   const faqsToApply = options.faqs?.length
//     ? options.faqs
//     : mergeFaqs(
//         analysis.existingFaqs || product?.existingFaqs || [],
//         analysis.faq || [],
//       )

//   let includeFaqInDescription = false
//   const updatePayload = {
//     title: analysis.optimizedTitle,
//     tags: [
//       ...(analysis.intentKeywords || []).slice(0, 10),
//       ...(analysis.bestFor || []).slice(0, 5),
//     ].join(", "),
//   }

//   if (faqStrategy === "inline") {
//     includeFaqInDescription = true
//     let baseDescription = analysis.optimizedDescription || ""

//     // If product already has FAQ section, replace it cleanly
//     if (product?.hasFaqSection && product.descriptionHtml) {
//       baseDescription =
//         removeFaqSectionFromHtml(product.descriptionHtml) ||
//         analysis.optimizedDescription ||
//         ""
//       // Prefer optimized description content if available
//       if (analysis.optimizedDescription) {
//         baseDescription = removeFaqSectionFromHtml(
//           analysis.optimizedDescription,
//         )
//       }
//     }

//     updatePayload.body_html = buildOptimizedDescription(
//       { ...analysis, optimizedDescription: baseDescription, faq: faqsToApply },
//       { includeFaqInDescription: true },
//     )
//   } else if (faqStrategy === "metafield") {
//     // Description without FAQ block
//     updatePayload.body_html = buildOptimizedDescription(analysis, {
//       includeFaqInDescription: false,
//     })

//     try {
//       await shopifyService.upsertProductFaqMetafield(
//         store.shopDomain,
//         store.accessToken,
//         shopifyProductId,
//         faqsToApply.map(({ question, answer }) => ({ question, answer })),
//       )
//       logger.info(`FAQ metafield updated for product ${shopifyProductId}`)
//     } catch (err) {
//       logger.warn(
//         `Metafield FAQ write failed, falling back to inline: ${err.message}`,
//       )
//       updatePayload.body_html = buildOptimizedDescription(
//         { ...analysis, faq: faqsToApply },
//         { includeFaqInDescription: true },
//       )
//       includeFaqInDescription = true
//     }
//   } else {
//     // skip FAQ changes — only update description content
//     updatePayload.body_html = buildOptimizedDescription(analysis, {
//       includeFaqInDescription: false,
//     })
//   }

//   const updatedProduct = await shopifyService.updateProduct(
//     store.shopDomain,
//     store.accessToken,
//     shopifyProductId,
//     updatePayload,
//   )

//   await syncSingleProduct(storeId, shopifyProductId)

//   return {
//     product: updatedProduct,
//     faqStrategy: includeFaqInDescription ? "inline" : faqStrategy,
//     faqsApplied: faqsToApply.length,
//   }
// }

// export { syncAllProducts, syncSingleProduct, applyOptimisationToShopify }

import logger from "../config/logger.js"
import Product from "../models/product.model.js"
import Store from "../models/store.model.js"
import * as shopifyService from "./shopify.service.js"
import {
  extractFaqsFromHtml,
  hasFaqSectionInHtml,
  removeFaqSectionFromHtml,
  buildFaqHtml,
  mergeFaqs,
  resolveFaqStrategy,
  buildOptimizedDescription,
} from "./faq.service.js"

function mapProductFields(raw, metafieldFaqs = [], extra = {}) {
  const descriptionHtml = raw.body_html || ""
  const inlineFaqs = extractFaqsFromHtml(descriptionHtml)
  const hasInlineFaq =
    hasFaqSectionInHtml(descriptionHtml) || inlineFaqs.length > 0

  let existingFaqs = []
  let faqSource = "none"

  if (metafieldFaqs.length > 0) {
    existingFaqs = metafieldFaqs
    faqSource = "metafield"
  } else if (inlineFaqs.length > 0) {
    existingFaqs = inlineFaqs.map((f) => ({ ...f, source: "description" }))
    faqSource = "description"
  }

  return {
    title: raw.title,
    description: descriptionHtml.replace(/<[^>]*>/g, "") || "",
    descriptionHtml,
    brand: raw.vendor || null,
    tags: raw.tags
      ? raw.tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean)
      : [],
    variants: (raw.variants || []).map((v) => ({
      shopifyVariantId: String(v.id),
      title: v.title,
      price: v.price,
      sku: v.sku,
      inventory_quantity: v.inventory_quantity,
      option1: v.option1,
      option2: v.option2,
      option3: v.option3,
    })),
    images: (raw.images || []).map((img) => img.src),
    productType: raw.product_type,
    vendor: raw.vendor,
    collections: extra.collections || [],
    reviews: extra.reviews || [],
    metafields: extra.metafields || [],
    handle: raw.handle,
    status: raw.status,
    existingFaqs,
    faqSource,
    hasFaqSection: hasInlineFaq,
    shopifyCreatedAt: raw.created_at,
    shopifyUpdatedAt: raw.updated_at,
    syncedAt: new Date(),
  }
}

/**
 * Full sync: pull all products from Shopify and upsert into MongoDB.
 */
async function enrichProductFromShopify(store, raw) {
  let metafieldFaqs = []
  let metafields = []
  let collections = []
  let reviews = []

  try {
    metafields = await shopifyService.fetchProductMetafields(
      store.shopDomain,
      store.accessToken,
      raw.id,
    )
    metafieldFaqs = shopifyService.parseFaqsFromMetafields(metafields)
    reviews = shopifyService.parseReviewsFromMetafields(metafields)
  } catch {
    // metafield scope may not be granted
  }

  try {
    collections = await shopifyService.fetchProductCollections(
      store.shopDomain,
      store.accessToken,
      raw.id,
    )
  } catch {
    // collections optional
  }

  // console.log(
  //   "MAPPED METAFIELDS:",
  //   JSON.stringify(shopifyService.mapProductMetafields(metafields), null, 2),
  // )

  return mapProductFields(raw, metafieldFaqs, {
    collections,
    reviews,
    metafields: shopifyService.mapProductMetafields(metafields),
  })
}

/**
 * Full sync: pull all products from Shopify and upsert into MongoDB.
 */
async function syncAllProducts(storeId) {
  const store = await Store.findById(storeId)
  if (!store) throw new Error("Store not found")

  const rawProducts = await shopifyService.fetchAllProducts(
    store.shopDomain,
    store.accessToken,
  )

  let synced = 0
  for (const raw of rawProducts) {
    const fields = await enrichProductFromShopify(store, raw)

    await Product.findOneAndUpdate(
      { storeId, shopifyProductId: String(raw.id) },
      { storeId, shopifyProductId: String(raw.id), ...fields },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    )
    synced++
  }

  await Store.findByIdAndUpdate(storeId, {
    totalProductsSynced: synced,
    lastSyncedAt: new Date(),
  })

  logger.info(`Sync complete for store ${store.shopDomain}: ${synced} products`)
  return synced
}

/**
 * Sync a single product from Shopify (used after webhook).
 */
async function syncSingleProduct(storeId, shopifyProductId) {
  const store = await Store.findById(storeId)
  if (!store) throw new Error("Store not found")

  const raw = await shopifyService.fetchProduct(
    store.shopDomain,
    store.accessToken,
    shopifyProductId,
  )

  const fields = await enrichProductFromShopify(store, raw)

  // console.log("METAFIELDS IS ARRAY:", Array.isArray(fields.metafields))

  // console.log("FIRST METAFIELD:", fields.metafields?.[0])

  return Product.findOneAndUpdate(
    { storeId, shopifyProductId: String(raw.id) },
    fields,
    { upsert: true, new: true, setDefaultsOnInsert: true },
  )
}

/**
 * Sync exactly the products the merchant selected in the picker.
 * Does NOT touch the plan-limit check — that's enforced by
 * enforceProductSyncLimit() in the route, before this runs.
 * If a product was previously removed, this re-adds it (clears the flag)
 * rather than creating a duplicate.
 */
async function syncSelectedProducts(storeId, shopifyProductIds = []) {
  const store = await Store.findById(storeId)
  if (!store) throw new Error("Store not found")

  const results = { synced: [], failed: [] }

  for (const shopifyProductId of shopifyProductIds) {
    try {
      const raw = await shopifyService.fetchProduct(
        store.shopDomain,
        store.accessToken,
        shopifyProductId,
      )
      const fields = await enrichProductFromShopify(store, raw)

      const product = await Product.findOneAndUpdate(
        { storeId, shopifyProductId: String(raw.id) },
        {
          storeId,
          shopifyProductId: String(raw.id),
          ...fields,
          isRemovedFromSync: false,
          removedAt: null,
          selectedAt: new Date(),
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      results.synced.push({ productId: product._id, shopifyProductId })
    } catch (err) {
      logger.warn(
        `Failed to sync selected product ${shopifyProductId}: ${err.message}`,
      )
      results.failed.push({ shopifyProductId, error: err.message })
    }
  }

  await Store.findByIdAndUpdate(storeId, { lastSyncedAt: new Date() })

  logger.info(
    `Selective sync for ${store.shopDomain}: ${results.synced.length} synced, ${results.failed.length} failed`,
  )
  return results
}

/**
 * Remove a product from the active sync set. Keeps the document (and all
 * its analysis/optimization history) — just frees up a plan slot.
 */
async function removeProductFromSync(storeId, productId) {
  const product = await Product.findOneAndUpdate(
    { _id: productId, storeId },
    { isRemovedFromSync: true, removedAt: new Date() },
    { new: true },
  )
  if (!product) throw new Error("Product not found")
  return product
}

/**
 * Apply optimised content back to Shopify product.
 * FAQ handling:
 *  - inline: update/create FAQ section in description (not duplicated in optimizedDescription)
 *  - metafield: write to recomind.faqs metafield
 *  - skip: don't touch FAQs
 */
// async function applyOptimisationToShopify(
//   storeId,
//   shopifyProductId,
//   analysis,
//   options = {},
// ) {
//   const store = await Store.findById(storeId)
//   if (!store) throw new Error("Store not found")

//   //console.log("accessToken from updateProduct:", store.accessToken)

//   const product = await Product.findOne({
//     storeId,
//     shopifyProductId: String(shopifyProductId),
//   })
//   const faqStrategy = resolveFaqStrategy(
//     product || {},
//     store,
//     options.faqStrategy,
//   )

//   const faqsToApply = options.faqs?.length
//     ? options.faqs
//     : mergeFaqs(
//         analysis.existingFaqs || product?.existingFaqs || [],
//         analysis.faq || [],
//       )

//   let includeFaqInDescription = false
//   const updatePayload = {
//     title: analysis.optimizedTitle,
//     tags: [
//       ...(analysis.intentKeywords || []).slice(0, 10),
//       ...(analysis.bestFor || []).slice(0, 5),
//     ].join(", "),
//   }

//   if (faqStrategy === "inline") {
//     includeFaqInDescription = true
//     let baseDescription = analysis.optimizedDescription || ""

//     // If product already has FAQ section, replace it cleanly
//     if (product?.hasFaqSection && product.descriptionHtml) {
//       baseDescription =
//         removeFaqSectionFromHtml(product.descriptionHtml) ||
//         analysis.optimizedDescription ||
//         ""
//       // Prefer optimized description content if available
//       if (analysis.optimizedDescription) {
//         baseDescription = removeFaqSectionFromHtml(
//           analysis.optimizedDescription,
//         )
//       }
//     }

//     updatePayload.body_html = buildOptimizedDescription(
//       { ...analysis, optimizedDescription: baseDescription, faq: faqsToApply },
//       { includeFaqInDescription: true },
//     )
//   } else if (faqStrategy === "metafield") {
//     // Description without FAQ block
//     updatePayload.body_html = buildOptimizedDescription(analysis, {
//       includeFaqInDescription: false,
//     })

//     try {
//       await shopifyService.upsertProductFaqMetafield(
//         store.shopDomain,
//         store.accessToken,
//         shopifyProductId,
//         faqsToApply.map(({ question, answer }) => ({ question, answer })),
//       )
//       logger.info(`FAQ metafield updated for product ${shopifyProductId}`)
//     } catch (err) {
//       logger.warn(
//         `Metafield FAQ write failed, falling back to inline: ${err.message}`,
//       )
//       updatePayload.body_html = buildOptimizedDescription(
//         { ...analysis, faq: faqsToApply },
//         { includeFaqInDescription: true },
//       )
//       includeFaqInDescription = true
//     }
//   } else {
//     // skip FAQ changes — only update description content
//     updatePayload.body_html = buildOptimizedDescription(analysis, {
//       includeFaqInDescription: false,
//     })
//   }

//   const updatedProduct = await shopifyService.updateProduct(
//     store.shopDomain,
//     store.accessToken,
//     shopifyProductId,
//     updatePayload,
//   )

//   await syncSingleProduct(storeId, shopifyProductId)

//   return {
//     product: updatedProduct,
//     faqStrategy: includeFaqInDescription ? "inline" : faqStrategy,
//     faqsApplied: faqsToApply.length,
//   }
// }

/**
 * Apply optimised content back to Shopify product.
 * FAQ handling:
 *  - inline: update/create FAQ section in description (not duplicated in optimizedDescription)
 *  - metafield: write to recomind.faqs metafield
 *  - skip: don't touch FAQs
 */
async function applyOptimisationToShopify(
  storeId,
  shopifyProductId,
  analysis,
  options = {},
) {
  const store = await Store.findById(storeId)
  if (!store) throw new Error("Store not found")
 
  const product = await Product.findOne({
    storeId,
    shopifyProductId: String(shopifyProductId),
  })
 
  // FAQs are intentionally NEVER pushed to Shopify (not inlined into the
  // description, not written to a metafield) — they stay visible on the
  // RecoMind analysis/product-detail page only, which reads them straight
  // from MongoDB and is unaffected by this. Title, description content
  // (minus any FAQ block), and tags still apply exactly as before.
  const faqStrategy = "skip"
 
  const updatePayload = {
    title: analysis.optimizedTitle,
    tags: [
      ...(analysis.intentKeywords || []).slice(0, 10),
      ...(analysis.bestFor || []).slice(0, 5),
    ].join(", "),
    body_html: buildOptimizedDescription(analysis, {
      includeFaqInDescription: false,
    }),
  }
 
  const updatedProduct = await shopifyService.updateProduct(
    store.shopDomain,
    store.accessToken,
    shopifyProductId,
    updatePayload,
  )
 
  await syncSingleProduct(storeId, shopifyProductId)
 
  return {
    product: updatedProduct,
    faqStrategy,
    faqsApplied: 0,
  }
}

export {
  syncAllProducts,
  syncSingleProduct,
  syncSelectedProducts,
  removeProductFromSync,
  applyOptimisationToShopify,
}