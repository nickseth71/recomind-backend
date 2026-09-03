import mongoose from "mongoose"

const llmFilesSchema = new mongoose.Schema(
  {
    storeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Store",
      required: true,
      unique: true,
      index: true,
    },
    files: {
      agents: { type: String, default: "" },
      llms: { type: String, default: "" },
      llmsFull: { type: String, default: "" },
    },
    generatedAt: { type: Date, default: Date.now },
    publishedAt: { type: Date, default: null },
    publishedThemeId: { type: String, default: null },
  },
  { timestamps: true },
)

export default mongoose.model("LlmFiles", llmFilesSchema)
