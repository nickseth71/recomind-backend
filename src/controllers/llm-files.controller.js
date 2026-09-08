import LlmFiles from "../models/llm-files.model.js"
import {
  generateLlmFiles,
  publishLlmFiles,
} from "../services/llm-files.service.js"

export async function getLlmFiles(req, res, next) {
  try {
    const files = await LlmFiles.findOne({ storeId: req.store._id }).lean()
    res.json({
      success: true,
      data: files || { files: {}, generatedAt: null, publishedAt: null },
    })
  } catch (error) {
    next(error)
  }
}

export async function regenerateLlmFiles(req, res, next) {
  try {
    const files = await generateLlmFiles(req.store)
    res.json({ success: true, data: files })
  } catch (error) {
    next(error)
  }
}

export async function publishGeneratedLlmFiles(req, res, next) {
  try {
    const files = await LlmFiles.findOne({ storeId: req.store._id })
    if (!files)
      return res
        .status(400)
        .json({ success: false, error: "Generate AI discovery files first" })
    const result = await publishLlmFiles(req.store, files)
    res.json({
      success: true,
      data: { ...result, publishedAt: files.publishedAt },
    })
  } catch (error) {
    if (error.statusCode === 401) {
      error.message =
        "Shopify connection expired. Reopen the app to refresh the connection, then publish again."
    }
    next(error)
  }
}
