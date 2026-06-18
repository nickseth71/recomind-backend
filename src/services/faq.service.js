import logger from "../config/logger.js"

const FAQ_HEADING_PATTERNS = [
  /frequently\s+asked\s+questions/i,
  /\bfaq\b/i,
  /common\s+questions/i,
  /q\s*&\s*a/i,
]

/**
 * Extract FAQ pairs from product HTML description.
 * Supports h3/h4 + p patterns and details/summary blocks.
 */
function extractFaqsFromHtml(html) {
  if (!html) return []

  const faqs = []

  // <details><summary>Q</summary>answer</details>
  const detailsRegex =
    /<details[^>]*>\s*<summary[^>]*>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>/gi
  let match
  while ((match = detailsRegex.exec(html)) !== null) {
    const question = stripHtml(match[1]).trim()
    const answer = stripHtml(match[2]).trim()
    if (question && answer) faqs.push({ question, answer })
  }
  if (faqs.length) return faqs

  // Find FAQ section by heading
  const headingRegex = /<h[2-4][^>]*>([\s\S]*?)<\/h[2-4]>/gi
  let faqSectionStart = -1

  while ((match = headingRegex.exec(html)) !== null) {
    const headingText = stripHtml(match[1])
    if (FAQ_HEADING_PATTERNS.some((p) => p.test(headingText))) {
      faqSectionStart = match.index
      break
    }
  }

  if (faqSectionStart === -1) return []

  const sectionHtml = html.slice(faqSectionStart)
  const pairRegex =
    /<h[3-5][^>]*>([\s\S]*?)<\/h[3-5]>\s*(?:<p[^>]*>([\s\S]*?)<\/p>|<div[^>]*>([\s\S]*?)<\/div>)/gi

  while ((match = pairRegex.exec(sectionHtml)) !== null) {
    const question = stripHtml(match[1]).trim()
    const answer = stripHtml(match[2] || match[3] || "").trim()
    if (question && answer && question.length < 300) {
      faqs.push({ question, answer })
    }
  }

  return faqs
}

function stripHtml(html) {
  return (html || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .trim()
}

function hasFaqSectionInHtml(html) {
  if (!html) return false
  return (
    FAQ_HEADING_PATTERNS.some((p) => p.test(stripHtml(html))) ||
    /<details[^>]*>/i.test(html)
  )
}

/**
 * Remove the FAQ section from HTML so we can replace it cleanly.
 */
function removeFaqSectionFromHtml(html) {
  if (!html) return ""

  const detailsRegex =
    /<h[2-4][^>]*>[\s\S]*?(?:frequently\s+asked|faq|common\s+questions)[\s\S]*?<\/h[2-4]>[\s\S]*/i
  if (detailsRegex.test(html)) {
    return html.replace(detailsRegex, "").trim()
  }

  return html.replace(/<details[^>]*>[\s\S]*?<\/details>\s*/gi, "").trim()
}

function buildFaqHtml(faqs) {
  if (!faqs?.length) return ""
  const items = faqs
    .map(
      (f) => `<h4>${escapeHtml(f.question)}</h4><p>${escapeHtml(f.answer)}</p>`,
    )
    .join("\n")
  return `<h3>Frequently Asked Questions</h3>\n${items}`
}

function escapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

/**
 * Merge existing FAQs with AI-suggested updates.
 * Suggested FAQs with matching questions get updated answers; new ones are appended.
 */
function mergeFaqs(existingFaqs, suggestedFaqs) {
  const merged = [...(existingFaqs || [])]
  const existingQuestions = new Set(
    merged.map((f) => normalizeQuestion(f.question)),
  )

  for (const suggested of suggestedFaqs || []) {
    const norm = normalizeQuestion(suggested.question)
    const existingIdx = merged.findIndex(
      (f) => normalizeQuestion(f.question) === norm,
    )
    if (existingIdx >= 0) {
      merged[existingIdx] = {
        question: merged[existingIdx].question,
        answer: suggested.answer,
        updated: true,
      }
    } else if (!existingQuestions.has(norm)) {
      merged.push({ ...suggested, isNew: true })
      existingQuestions.add(norm)
    }
  }

  return merged
}

function normalizeQuestion(q) {
  return String(q || "")
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .trim()
}

/**
 * Decide how FAQs should be stored for this product/store.
 * auto: detect from existing product FAQ source or store preference
 */
function resolveFaqStrategy(product, store, override) {
  if (override && override !== "auto") return override

  if (product.faqSource === "metafield") return "metafield"
  if (product.faqSource === "description" || product.hasFaqSection)
    return "inline"
  if (store.faqStrategy && store.faqStrategy !== "auto")
    return store.faqStrategy

  // Default: inline FAQ section in description (works for most stores)
  return "inline"
}

/**
 * Build description HTML for optimize — keeps non-FAQ content separate from FAQs.
 */
function buildOptimizedDescription(analysis, options = {}) {
  const { includeFaqInDescription = true } = options

  const bestForHtml = analysis.bestFor?.length
    ? `<h3>Best For</h3><ul>${analysis.bestFor.map((b) => `<li>${escapeHtml(b)}</li>`).join("")}</ul>`
    : ""

  const trustHtml = analysis.trustSignals?.length
    ? `<h3>Quality & Trust</h3><ul>${analysis.trustSignals.map((t) => `<li>${escapeHtml(t)}</li>`).join("")}</ul>`
    : ""

  const parts = [analysis.optimizedDescription || "", bestForHtml, trustHtml]

  if (includeFaqInDescription && analysis.faq?.length) {
    parts.push(buildFaqHtml(analysis.faq))
  }

  return parts.filter(Boolean).join("\n\n")
}

/**
 * Analyze FAQ quality from existing vs suggested.
 */
function analyzeFaqState(existingFaqs, suggestedFaqs, scoreBreakdown) {
  const hasExisting = (existingFaqs || []).length > 0
  const hasSuggested = (suggestedFaqs || []).length > 0

  return {
    hasExistingFaqs: hasExisting,
    existingCount: (existingFaqs || []).length,
    suggestedCount: (suggestedFaqs || []).length,
    faqQualityScore: scoreBreakdown?.faqQuality ?? 0,
    needsImprovement: (scoreBreakdown?.faqQuality ?? 0) < 10,
    action:
      hasExisting && hasSuggested
        ? "update"
        : hasExisting
          ? "review"
          : hasSuggested
            ? "create"
            : "none",
  }
}

export {
  extractFaqsFromHtml,
  hasFaqSectionInHtml,
  removeFaqSectionFromHtml,
  buildFaqHtml,
  mergeFaqs,
  resolveFaqStrategy,
  buildOptimizedDescription,
  analyzeFaqState,
  stripHtml,
}
