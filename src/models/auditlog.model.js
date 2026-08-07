import mongoose from "mongoose"

const auditLogSchema = new mongoose.Schema(
  {
    storeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Store",
      required: true,
      index: true,
    },
    action: {
      type: String,
      required: true,
      enum: [
        "PRODUCT_ANALYSED",
        "PRODUCT_OPTIMISED",
        "PRODUCT_OPTIMISATION_ROLLED_BACK",
        "PROMPT_SIMULATED",
        "PROMPTS_GENERATED",
        "BULK_OPTIMISE_STARTED",
        "BULK_OPTIMISE_COMPLETED",
        "PRODUCTS_SYNCED",
        "STORE_INSTALLED",
        "STORE_REACTIVATED",
        "STORE_UNINSTALLED",
        "PLAN_CHANGED",
        "REPORT_EXPORTED",
        "MARKETS_ENABLED",
      ],
    },
    entityType: {
      type: String,
      enum: ["product", "store", "prompt", "report"],
    },
    entityId: mongoose.Schema.Types.ObjectId,
    metadata: mongoose.Schema.Types.Mixed, // flexible extra data
    performedBy: { type: String, default: "user" }, // "user" | "system" | "bulk"
    ipAddress: String,
  },
  { timestamps: true },
)

auditLogSchema.index({ storeId: 1, createdAt: -1 })
auditLogSchema.index({ action: 1 })

const AuditLog = mongoose.model("AuditLog", auditLogSchema)
export default AuditLog
