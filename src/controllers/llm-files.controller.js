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
    if (
      files.publishedAt &&
      files.generatedAt &&
      new Date(files.generatedAt) <= new Date(files.publishedAt)
    ) {
      return res.status(409).json({
        success: false,
        error: "No new AI Store Index changes are available to publish",
      })
    }
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
