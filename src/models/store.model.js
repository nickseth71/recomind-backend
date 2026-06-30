import mongoose from "mongoose"
import CryptoJS from "crypto-js"
import {
  planHasFeature,
  getTokenQuotaForPlan,
  getPromptLimits,
} from "../config/plans.js"

/**
 * ============================================================
 * Store Schema
 * ============================================================
 */

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

    // Encrypted Shopify access token (AES)
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

    // Token usage tracking
    monthlyTokenQuota: { type: Number, default: 0 },
    tokensUsedThisMonth: { type: Number, default: 0 },
    tokenQuotaResetDate: { type: Date, default: Date.now },
    lifetimeTokensUsed: { type: Number, default: 0 },

    shopName: { type: String, default: null },
    shopEmail: { type: String, default: null },
    shopOwner: { type: String, default: null },
    currency: { type: String, default: null },
    timezone: { type: String, default: null },

    totalProductsSynced: { type: Number, default: 0 },
    lastSyncedAt: { type: Date, default: null },

    usage: {
      productsAnalyzed: { type: Number, default: 0 },
      manualPromptsGenerated: { type: Number, default: 0 },
      autoPromptsGenerated: { type: Number, default: 0 },
    },

    faqStrategy: {
      type: String,
      enum: ["auto", "inline", "metafield"],
      default: "auto",
    },

    isActive: { type: Boolean, default: true },
    installedAt: { type: Date },
    uninstalledAt: { type: Date, default: null },
  },
  { timestamps: true },
)

/**
 * ============================================================
 * Encryption helpers
 * ============================================================
 */

function getEncryptionKey() {
  const key = process.env.ENCRYPTION_KEY
  if (!key) {
    throw new Error("ENCRYPTION_KEY is missing from environment variables")
  }
  return key
}

/**
 * ============================================================
 * Virtual: decrypted access token
 * ============================================================
 */

storeSchema.virtual("accessToken").get(function () {
  if (!this.accessTokenEncrypted) return null

  const key = getEncryptionKey()
  const bytes = CryptoJS.AES.decrypt(this.accessTokenEncrypted, key)

  const decrypted = bytes.toString(CryptoJS.enc.Utf8)
  return decrypted || null
})

/**
 * ============================================================
 * Methods
 * ============================================================
 */

// Encrypt + set Shopify access token
storeSchema.methods.setAccessToken = function (plainToken) {
  if (!plainToken) throw new Error("Access token is required")

  const key = getEncryptionKey()
  this.accessTokenEncrypted = CryptoJS.AES.encrypt(
    plainToken,
    key,
  ).toString()
}

// Check plan feature access
storeSchema.methods.hasFeature = function (feature) {
  return planHasFeature(this.plan, feature, this.addons || {})
}

// Plan quota helpers
storeSchema.methods.getTokenQuotaForPlan = function () {
  return getTokenQuotaForPlan(this.plan)
}

storeSchema.methods.getPromptLimits = function () {
  return getPromptLimits(this.plan, this.addons || {})
}

/**
 * ============================================================
 * Quota management
 * ============================================================
 */

storeSchema.methods.resetMonthlyQuotaIfNeeded = function () {
  const now = new Date()
  const lastReset = this.tokenQuotaResetDate || new Date()

  const daysSinceReset =
    (now.getTime() - lastReset.getTime()) / (1000 * 60 * 60 * 24)

  if (daysSinceReset >= 30) {
    this.tokensUsedThisMonth = 0
    this.tokenQuotaResetDate = now
    this.monthlyTokenQuota = this.getTokenQuotaForPlan()
    return true
  }

  return false
}

storeSchema.methods.canUseTokens = function (tokensNeeded = 0) {
  this.resetMonthlyQuotaIfNeeded()
  const remaining = this.monthlyTokenQuota - this.tokensUsedThisMonth
  return remaining >= tokensNeeded
}

storeSchema.methods.getRemainingTokens = function () {
  this.resetMonthlyQuotaIfNeeded()
  return Math.max(0, this.monthlyTokenQuota - this.tokensUsedThisMonth)
}

/**
 * Increment usage counters
 */
storeSchema.methods.incrementUsage = async function (field, amount = 1) {
  const allowed = [
    "productsAnalyzed",
    "manualPromptsGenerated",
    "autoPromptsGenerated",
  ]

  if (!allowed.includes(field)) return this.usage

  this.usage[field] = (this.usage[field] || 0) + amount
  await this.save()

  return this.usage
}

/**
 * Token deduction
 */
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

/**
 * ============================================================
 * Pre-save initialization
 * ============================================================
 */

storeSchema.pre("save", function (next) {
  if (!this.monthlyTokenQuota || this.monthlyTokenQuota === 0) {
    this.monthlyTokenQuota = this.getTokenQuotaForPlan()
  }
  next()
})

/**
 * ============================================================
 * Model export
 * ============================================================
 */

const Store = mongoose.model("Store", storeSchema)
export default Store