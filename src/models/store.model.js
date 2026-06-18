import mongoose from "mongoose"
import CryptoJS from "crypto-js"
import {
  planHasFeature,
  getTokenQuotaForPlan,
  getPromptLimits,
} from "../config/plans.js"

const storeSchema = new mongoose.Schema(
  {
    shopDomain: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    // Access token is AES-encrypted at rest
    accessTokenEncrypted: {
      type: String,
      required: true,
    },
    scope: {
      type: String,
      required: true,
    },
    plan: {
      type: String,
      enum: ["starter", "growth", "pro", "agency"],
      default: "starter",
    },
    planExpiresAt: {
      type: Date,
      default: null,
    },
    addons: {
      promptTracking: { type: Boolean, default: false },
      aiVisibilityAudit: { type: Boolean, default: false },
      aiVisibilityAuditAt: { type: Date, default: null },
    },
    // Token usage tracking (resets monthly)
    monthlyTokenQuota: { type: Number, default: 0 }, // Max tokens per month for this plan
    tokensUsedThisMonth: { type: Number, default: 0 }, // Tokens used in current month
    tokenQuotaResetDate: { type: Date, default: Date.now }, // When the monthly quota resets
    lifetimeTokensUsed: { type: Number, default: 0 }, // Total tokens used (all time)
    shopName: {
      type: String,
      default: null,
    },
    shopEmail: {
      type: String,
      default: null,
    },
    shopOwner: {
      type: String,
      default: null,
    },
    currency: {
      type: String,
      default: null,
    },
    timezone: {
      type: String,
      default: null,
    },
    totalProductsSynced: { type: Number, default: 0 },
    lastSyncedAt: { type: Date, default: null },
    // Plan usage counters (products analyzed, prompts generated)
    usage: {
      productsAnalyzed: { type: Number, default: 0 },
      manualPromptsGenerated: { type: Number, default: 0 },
      autoPromptsGenerated: { type: Number, default: 0 },
    },
    // FAQ storage preference: auto | inline | metafield
    faqStrategy: {
      type: String,
      enum: ["auto", "inline", "metafield"],
      default: "auto",
    },
    isActive: { type: Boolean, default: true },
    installedAt: { type: Date, default: Date.now },
    uninstalledAt: { type: Date, default: null },
  },
  { timestamps: true },
)

// Virtual: decode access token
storeSchema.virtual("accessToken").get(function () {
  if (!this.accessTokenEncrypted) return null
  const key = process.env.ENCRYPTION_KEY
  const bytes = CryptoJS.AES.decrypt(this.accessTokenEncrypted, key)
  return bytes.toString(CryptoJS.enc.Utf8)
})

// Auto-encrypt before save
storeSchema.pre("save", function (next) {
  if (this.isModified("accessTokenEncrypted")) return next()
  next()
})

// Helper: encrypt and set token
storeSchema.methods.setAccessToken = function (plainToken) {
  const key = process.env.ENCRYPTION_KEY
  this.accessTokenEncrypted = CryptoJS.AES.encrypt(plainToken, key).toString()
}

// Check plan features (includes paid add-ons)
storeSchema.methods.hasFeature = function (feature) {
  return planHasFeature(this.plan, feature, this.addons || {})
}

// Get token quota for this plan
storeSchema.methods.getTokenQuotaForPlan = function () {
  return getTokenQuotaForPlan(this.plan)
}

// Get prompt win dashboard limits for this plan
storeSchema.methods.getPromptLimits = function () {
  return getPromptLimits(this.plan, this.addons || {})
}

// Reset monthly quota if needed
storeSchema.methods.resetMonthlyQuotaIfNeeded = function () {
  const now = new Date()
  const lastReset = this.tokenQuotaResetDate || new Date()
  const daysSinceReset = (now - lastReset) / (1000 * 60 * 60 * 24)

  if (daysSinceReset >= 30) {
    this.tokensUsedThisMonth = 0
    this.tokenQuotaResetDate = now
    this.monthlyTokenQuota = this.getTokenQuotaForPlan()
    return true
  }
  return false
}

// Check if store can use tokens
storeSchema.methods.canUseTokens = function (tokensNeeded = 0) {
  this.resetMonthlyQuotaIfNeeded()
  const remaining = this.monthlyTokenQuota - this.tokensUsedThisMonth
  return remaining >= tokensNeeded
}

// Get remaining tokens for this month
storeSchema.methods.getRemainingTokens = function () {
  this.resetMonthlyQuotaIfNeeded()
  return Math.max(0, this.monthlyTokenQuota - this.tokensUsedThisMonth)
}

// Increment plan usage counters
storeSchema.methods.incrementUsage = async function (field, amount = 1) {
  if (!this.usage) this.usage = {}
  const key = field
  if (["productsAnalyzed", "manualPromptsGenerated", "autoPromptsGenerated"].includes(key)) {
    this.usage[key] = (this.usage[key] || 0) + amount
    await this.save()
  }
  return this.usage
}

// Deduct tokens from quota
storeSchema.methods.deductTokens = async function (amount) {
  this.resetMonthlyQuotaIfNeeded()

  if (!this.canUseTokens(amount)) {
    const err = new Error("Insufficient token quota for this month")
    err.statusCode = 429
    err.remainingTokens = this.getRemainingTokens()
    throw err
  }

  this.tokensUsedThisMonth += amount
  this.lifetimeTokensUsed += amount
  await this.save()

  return {
    used: amount,
    remaining: this.getRemainingTokens(),
    quota: this.monthlyTokenQuota,
  }
}

// Initialize quota on first save (pre-save hook)
storeSchema.pre("save", function (next) {
  if (!this.monthlyTokenQuota || this.monthlyTokenQuota === 0) {
    this.monthlyTokenQuota = this.getTokenQuotaForPlan()
  }
  next()
})

const Store = mongoose.model("Store", storeSchema)
export default Store
