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

    rawAiResponse: String,
  },
  { timestamps: true },
)

promptSimulationSchema.index({ storeId: 1, createdAt: -1 })

const PromptSimulation = mongoose.model(
  "PromptSimulation",
  promptSimulationSchema,
)
export default PromptSimulation
