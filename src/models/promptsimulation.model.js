import mongoose from "mongoose"

const promptSimulationSchema = new mongoose.Schema(
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
    sourceBatchId: { type: String, default: null, index: true },
    sourceRowNumber: { type: Number, default: null },
    promptFingerprint: { type: String, default: null, index: true },

    // Scoring
    recommendationScore: { type: Number, min: 0, max: 100, default: 0 },
    likelihood: { type: String, enum: ["LOW", "MED", "HIGH"], default: "LOW" },

    // AI analysis
    buyerIntent: String,
    expectedAttributes: [String],
    missingSignals: [String],
    rankingFactors: [String],
    competitorStrength: {
      type: String,
      enum: ["WEAK", "MODERATE", "STRONG"],
      default: "MODERATE",
    },
    competitorDominating: [String], // competitor brand names winning this prompt
    semanticGaps: [String],

    // What would improve the score
    recommendations: [String],
    marketContext: mongoose.Schema.Types.Mixed,

    rawAiResponse: String,
  },
  { timestamps: true },
)

promptSimulationSchema.index({ storeId: 1, createdAt: -1 })
promptSimulationSchema.index({ storeId: 1, productId: 1, promptFingerprint: 1 })

const PromptSimulation = mongoose.model(
  "PromptSimulation",
  promptSimulationSchema,
)
export default PromptSimulation
