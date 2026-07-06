import mongoose from "mongoose"

const productPromptSchema = new mongoose.Schema(
  {
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
      index: true,
    },
    storeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Store",
      required: true,
      index: true,
    },
    prompt: { type: String, required: true, trim: true },
    // Intent decomposition
    buyerIntent: String,
    queryType: String,
    extractedAttributes: [String],
    matchedAttributes: [String],
    missingSignals: [String],
    // Scoring
    intentCoverageScore: { type: Number, min: 0, max: 100, default: 0 },
    visibility: {
      type: String,
      enum: ["HIGH", "MEDIUM", "LOW"],
      default: "LOW",
    },
    statusMessage: String,
    recommendations: [String],
    // Extended AI fields
    comparison: { type: [mongoose.Schema.Types.Mixed], default: [] },
    rankingFactors: { type: [String], default: [] },
    competitorDominating: { type: [String], default: [] },
    semanticGaps: { type: [String], default: [] },
    reasoning: String,
    recommendedActions: {
      type: [mongoose.Schema.Types.Mixed],
      default: [],
    },
    // Tracking
    isTracked: { type: Boolean, default: true },
    lastScoredAt: Date,
    scoreHistory: [
      {
        score: Number,
        visibility: String,
        scoredAt: { type: Date, default: Date.now },
      },
    ],
    generatedBy: { type: String, enum: ["auto", "manual"], default: "auto" },
  },
  { timestamps: true },
)

productPromptSchema.index(
  { storeId: 1, productId: 1, prompt: 1 },
  { unique: true },
)
productPromptSchema.index({ storeId: 1, visibility: 1 })
productPromptSchema.index({ storeId: 1, isTracked: 1 })

const ProductPrompt = mongoose.model("ProductPrompt", productPromptSchema)
export default ProductPrompt
