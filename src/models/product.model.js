import mongoose from "mongoose"

const variantSchema = new mongoose.Schema(
  {
    shopifyVariantId: String,
    title: String,
    price: String,
    sku: String,
    inventory_quantity: Number,
  },
  { _id: false },
)

const metafieldSchema = new mongoose.Schema(
  {
    namespace: String,
    key: String,
    value: String,
    type: String,
  },
  { _id: false }
)

const productSchema = new mongoose.Schema(
  {
    storeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Store",
      required: true,
      index: true,
    },
    shopifyProductId: {
      type: String,
      required: true,
      index: true,
    },
    title: { type: String, required: true },
    description: String,
    descriptionHtml: String,
    // FAQ state from Shopify
    existingFaqs: [
      {
        question: String,
        answer: String,
        source: { type: String, enum: ["description", "metafield"] },
      },
    ],
    faqSource: {
      type: String,
      enum: ["none", "description", "metafield"],
      default: "none",
    },
    hasFaqSection: { type: Boolean, default: false },
    tags: [String],
    variants: [variantSchema],
    images: [String],
    productType: String,
    vendor: String,
    brand: String,
    handle: String,
    collections: [
      {
        title: String,
        handle: String,
        shopifyCollectionId: String,
      },
    ],
    reviews: [
      {
        rating: Number,
        body: String,
        author: String,
        date: Date,
        source: { type: String, default: "metafield" },
      },
    ],
    metafields: [metafieldSchema],
    manualPromptsCount: { type: Number, default: 0 },
    autoPromptsCount: { type: Number, default: 0 },
    analyzationCount: { type: Number, default: 0 },
    conversionMetrics: {
      baseline: {
        conversionRate: { type: Number, default: null },
        orders: { type: Number, default: 0 },
        views: { type: Number, default: 0 },
        revenue: { type: Number, default: 0 },
        recordedAt: Date,
        source: {
          type: String,
          enum: ["manual", "shopify", "utm"],
          default: "manual",
        },
        utmSource: String,
      },
      postOptimization: {
        conversionRate: { type: Number, default: null },
        orders: { type: Number, default: 0 },
        views: { type: Number, default: 0 },
        revenue: { type: Number, default: 0 },
        recordedAt: Date,
        source: {
          type: String,
          enum: ["manual", "shopify", "utm"],
          default: "manual",
        },
        utmSource: String,
      },
      conversionGrowthPercent: { type: Number, default: null },
      revenueGrowthPercent: { type: Number, default: null },
    },
    status: {
      type: String,
      enum: ["active", "draft", "archived"],
      default: "active",
    },
    // AI analysis fields
    analysisScore: { type: Number, default: null, min: 0, max: 100 },
    isOptimized: { type: Boolean, default: false },
    lastAnalysedAt: Date,
    lastAnalysedProductHash: String, // Hash of product data when last analysed - used to detect if product changed
    // Shopify sync
    shopifyCreatedAt: Date,
    shopifyUpdatedAt: Date,
    syncedAt: { type: Date, default: Date.now },
    productCategory: String,
    primaryBuyer: String,
  },
  { timestamps: true },
)

// Compound index: one product per store
productSchema.index({ storeId: 1, shopifyProductId: 1 }, { unique: true })



const Product = mongoose.model("Product", productSchema)

// console.log("METAFIELDS PATH:")
// console.log(Product.schema.path("metafields"))

export default Product
