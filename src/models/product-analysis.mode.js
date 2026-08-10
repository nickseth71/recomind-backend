import mongoose from "mongoose"

const faqSchema = new mongoose.Schema(
  { question: String, answer: String },
  { _id: false },
)

const inferredAttributeSchema = new mongoose.Schema(
  {
    attribute: String,
    inferredFrom: String,
    confidence: { type: String, enum: ["HIGH", "MEDIUM", "LOW"] },
    aiImportance: String,
  },
  { _id: false },
)

const productAnalysisSchema = new mongoose.Schema(
  {
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
      index: true,
    },
    productTitle: { type: String, required: true },
    storeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Store",
      required: true,
      index: true,
    },
    images: [String],
    marketContext: mongoose.Schema.Types.Mixed,

    // ── Overall AI readiness score 0–100 ─────────────────────────────
    score: { type: Number, required: true, min: 0, max: 100 },

    // ── NEW score breakdown (replaces old fields) ─────────────────────
    scoreBreakdown: {
      productClarity: { type: Number, default: 0 }, // max 20 — does AI understand what this IS?
      audienceSignals: { type: Number, default: 0 }, // max 15 — who is this for?
      useCaseDepth: { type: Number, default: 0 }, // max 20 — what problems does it solve?
      trustAndCredibility: { type: Number, default: 0 }, // max 15 — reviews, certs, proof points
      faqAndObjections: { type: Number, default: 0 }, // max 15 — handles real buyer objections?
      promptReadiness: { type: Number, default: 0 }, // max 15 — would AI confidently recommend?
    },

    // ── Stage 1: Product Interpretation ──────────────────────────────
    // Persisted so downstream features (prompt scoring, simulate) can
    // use it without re-running Stage 1 on every call.
    interpretation: {
      productIdentity: {
        coreProduct: String,
        productCategory: String,
        subCategory: String,
        productFormFactor: String,
        keyIngredients: [String],
        brandPositioning: String,
        confidence: { type: String, enum: ["HIGH", "MEDIUM", "LOW"] },
      },
      audienceProfile: {
        primaryBuyer: String,
        secondaryBuyers: [String],
        buyerMotivation: String,
        experienceLevel: String,
        lifestyleContext: [String],
        purchaseTrigger: String,
        buyerObjections: [String],
        pricesSensitivity: { type: String, enum: ["LOW", "MEDIUM", "HIGH"] },
      },
      useCaseMap: {
        primaryUseCase: String,
        secondaryUseCases: [String],
        timeOfUse: String,
        frequencyOfUse: String,
        situationalContext: [String],
        pairedProducts: [String],
      },
      semanticAttributes: {
        inferredAttributes: [inferredAttributeSchema],
        explicitAttributes: [String],
        missingCriticalAttributes: [String],
      },
      competitiveContext: {
        directCompetitors: [String],
        differentiators: [String],
        weaknesses: [String],
        marketPosition: String,
      },
      aiReadinessGaps: {
        criticalGaps: [String],
        moderateGaps: [String],
        minorGaps: [String],
      },
    },

    // ── Stage 3: Smart Prompts ────────────────────────────────────────
    smartPrompts: {
      prompts: [
        {
          prompt: String,
          intent: String,
          stage: {
            type: String,
            enum: ["awareness", "comparison", "decision"],
          },
          promptType: String,
          targetedAttribute: String,
          winProbability: { type: String, enum: ["HIGH", "MEDIUM", "LOW"] },
          _id: false,
        },
      ],
      promptClusters: [
        {
          clusterName: String,
          rationale: String,
          prompts: [String],
          _id: false,
        },
      ],
      highValuePrompts: [String],
      hardToWinPrompts: [String],
    },

    // ── AI-generated enrichments ──────────────────────────────────────
    bestFor: [String],
    intentKeywords: [String],
    intentClusters: [String],
    missingSignals: [String],
    comparisonOpportunities: [String],
    trustSignals: [String],
    reasoning: String,

    // ── FAQ fields ────────────────────────────────────────────────────
    faq: [faqSchema],
    existingFaqs: [faqSchema],
    faqAnalysis: {
      hasExistingFaqs: { type: Boolean, default: false },
      existingCount: { type: Number, default: 0 },
      suggestedCount: { type: Number, default: 0 },
      needsImprovement: { type: Boolean, default: false },
      action: {
        type: String,
        enum: ["none", "create", "update", "review"],
        default: "none",
      },
      recommendedStrategy: {
        type: String,
        enum: ["inline", "metafield", "skip"],
        default: "inline",
      },
      objectionsCovered: [String],
      objectionsUncovered: [String],
    },

    // ── Optimized content ─────────────────────────────────────────────
    optimizedTitle: String,
    optimizedDescription: String,

    // ── Category-aware attribute detection ──────────────────────────
    // Which product-category this analysis used to decide which
    // attributes are even relevant (e.g. nutrition for Food, but NOT
    // for a t-shirt), and the per-attribute checklist that resulted.
    categoryAttributeChecklist: {
      detectedCategory: String,
      attributes: [
        {
          attribute: String,
          status: {
            type: String,
            enum: [
              "present",
              "present_unstructured",
              "missing",
              "not_applicable",
            ],
          },
          evidence: String,
          recommendation: String,
        },
      ],
    },

    // ── Prioritized fixes (new — from Stage 2) ────────────────────────
    prioritizedFixes: [
      {
        priority: Number,
        fix: String,
        suggestedFix: String,
        applyField: {
          type: String,
          enum: ["title", "description", "tags", "faq", "metafield"],
          default: "description",
        },
        fixHtml: String,
        impact: { type: String, enum: ["HIGH", "MEDIUM", "LOW"] },
        reason: String,
        effort: { type: String, enum: ["HIGH", "MEDIUM", "LOW"] },
        applied: { type: Boolean, default: false },
        appliedAt: Date,
        _id: false,
      },
    ],

    // ── Competitor benchmark table (plan-gated) ───────────────────────
    competitorBenchmark: {
      columns: [String],
      competitors: [
        {
          productName: String,
          isMerchantProduct: { type: Boolean, default: false },
          attributes: mongoose.Schema.Types.Mixed,
          faqSection: String,
          customerReviews: String,
          aiVisibilityScore: Number,
          _id: false,
        },
      ],
      categoryDimensions: [String],
      generatedAt: Date,
    },

    // ── Engine-specific coverage (0–100) ─────────────────────────────
    engineCoverage: {
      chatgpt: { type: Number, default: 0 },
      perplexity: { type: Number, default: 0 },
      gemini: { type: Number, default: 0 },
      aiOverview: { type: Number, default: 0 },
    },

    // ── Meta ──────────────────────────────────────────────────────────
    rawAiResponse: String,
    appliedToShopify: { type: Boolean, default: false },
    appliedAt: Date,
    appliedBy: String, // "user" | "bulk"
    version: { type: Number, default: 1 },
  },
  { timestamps: true },
)

productAnalysisSchema.index({ productId: 1, createdAt: -1 })
productAnalysisSchema.index({ storeId: 1, createdAt: -1 })

const ProductAnalysis = mongoose.model("ProductAnalysis", productAnalysisSchema)
export default ProductAnalysis
