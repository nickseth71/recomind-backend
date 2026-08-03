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
    // Refresh token (Shopify's expiring offline access token model, opt-in
    // since Dec 2025). Also AES-encrypted at rest, same as the access token.
    refreshTokenEncrypted: {
      type: String,
      default: null,
    },
    accessTokenExpiresAt: {
      type: Date,
      default: null,
    },
    refreshTokenExpiresAt: {
      type: Date,
      default: null,
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
    region: {
      country: String, // "India"
      countryCode: String, // "IN"
      province: String,
      provinceCode: String,
      updatedAt: Date,
    },

    // Store model — add this field
    markets: [
      {
        marketId: { type: String, required: true }, // Shopify gid, e.g. "gid://shopify/Market/123"
        name: String,
        enabled: { type: Boolean, default: false },
        primary: { type: Boolean, default: false },
        regions: [
          {
            code: String, // ISO country code
            name: String,
          },
        ],
        firstSeenAt: { type: Date, default: Date.now },
        enabledAt: Date, // set the first time we observe enabled: true
        lastSyncedAt: Date,
      },
    ],
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

// Virtual: decode refresh token
storeSchema.virtual("refreshToken").get(function () {
  if (!this.refreshTokenEncrypted) return null
  const key = process.env.ENCRYPTION_KEY
  const bytes = CryptoJS.AES.decrypt(this.refreshTokenEncrypted, key)
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

// Helper: decrypt and return token for Shopify API calls
storeSchema.methods.getAccessToken = function () {
  return this.accessToken || null
}

// Helper: encrypt and set refresh token
storeSchema.methods.setRefreshToken = function (plainToken) {
  if (!plainToken) return
  const key = process.env.ENCRYPTION_KEY
  this.refreshTokenEncrypted = CryptoJS.AES.encrypt(plainToken, key).toString()
}

// Helper: decrypt and return refresh token
storeSchema.methods.getRefreshToken = function () {
  return this.refreshToken || null
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
  if (
    [
      "productsAnalyzed",
      "manualPromptsGenerated",
      "autoPromptsGenerated",
    ].includes(key)
  ) {
    this.usage[key] = (this.usage[key] || 0) + amount
    await this.save()
  }
  return this.usage
}

// Deduct tokens from quota
storeSchema.methods.deductTokens = async function (amount) {
  this.resetMonthlyQuotaIfNeeded()
  // Persist a quota reset if one just happened, so the atomic filter
  // below compares against the correct (possibly just-reset) values.
  if (this.isModified()) {
    await this.save()
  }

  const Store = this.constructor

  // Atomic check-and-increment: MongoDB applies this as a single operation,
  // so concurrent calls (e.g. bulk analysis jobs running in parallel on the
  // worker) can never read a stale in-memory value and overwrite each
  // other's deduction — each increment is guaranteed to apply on top of
  // whatever the previous one left behind.
  const updated = await Store.findOneAndUpdate(
    {
      _id: this._id,
      $expr: {
        $lte: [
          { $add: ["$tokensUsedThisMonth", amount] },
          "$monthlyTokenQuota",
        ],
      },
    },
    { $inc: { tokensUsedThisMonth: amount, lifetimeTokensUsed: amount } },
    { new: true },
  )

  if (!updated) {
    const fresh = await Store.findById(this._id)
    const err = new Error("Insufficient token quota for this month")
    err.statusCode = 429
    err.remainingTokens = Math.max(
      0,
      (fresh?.monthlyTokenQuota || 0) - (fresh?.tokensUsedThisMonth || 0),
    )
    throw err
  }

  // Keep this in-memory instance in sync for any code that reads
  // store.tokensUsedThisMonth right after calling deductTokens.
  this.tokensUsedThisMonth = updated.tokensUsedThisMonth
  this.lifetimeTokensUsed = updated.lifetimeTokensUsed

  return {
    used: amount,
    remaining: Math.max(
      0,
      updated.monthlyTokenQuota - updated.tokensUsedThisMonth,
    ),
    quota: updated.monthlyTokenQuota,
  }
}

// Initialize quota on first save (pre-save hook)
storeSchema.pre("save", function (next) {
  if (!this.monthlyTokenQuota || this.monthlyTokenQuota === 0) {
    this.monthlyTokenQuota = this.getTokenQuotaForPlan()
  }
  next()
})

// Refund tokens (e.g. a job that was pre-charged at enqueue time ultimately
// failed). Atomic and clamped at 0 — uses an aggregation-pipeline update so
// concurrent refunds/deductions can never push the counter negative or lose
// each other's changes, same reasoning as deductTokens.
storeSchema.methods.refundTokens = async function (amount) {
  if (!amount || amount <= 0) return null
  const Store = this.constructor
  const updated = await Store.findOneAndUpdate(
    { _id: this._id },
    [
      {
        $set: {
          tokensUsedThisMonth: {
            $max: [0, { $subtract: ["$tokensUsedThisMonth", amount] }],
          },
          lifetimeTokensUsed: {
            $max: [0, { $subtract: ["$lifetimeTokensUsed", amount] }],
          },
        },
      },
    ],
    { new: true },
  )
  if (updated) {
    this.tokensUsedThisMonth = updated.tokensUsedThisMonth
    this.lifetimeTokensUsed = updated.lifetimeTokensUsed
  }
  return updated
}

const Store = mongoose.model("Store", storeSchema)
export default Store
