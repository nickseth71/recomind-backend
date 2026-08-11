/**
 * RecoMind billing plans — aligned with pricing page.
 *
 * Starter  $29/mo  — lead generator, basic visibility
 * Growth   $99/mo  — main revenue tier
 * Pro      $299/mo — Shopify Plus / agencies (legacy alias: agency)
 *
 * Add-ons:
 *   promptTracking      $19/mo
 *   aiVisibilityAudit   $149 one-time
 */

const PLAN_CONFIG = {
  starter: {
    id: "starter",
    label: "Starter",
    priceMonthly: 29,
    tagline: "See where your products stand in AI shopping",
    monthlyTokenQuota: 5000,
    maxProductsAnalyzed: 25,
    maxProductsReAnalyze: 1,
    promptsPerProduct: 3,
    manualPromptsPerProduct: 10,
    competitorCount: 0,
    totalTrackedPrompts: Infinity,
    promptTracking: false,
    scanFrequency: "weekly",
    dashboardLevel: "basic",
    features: [
      "analyze",
      "optimize",
      "applyFixBasic",
      "promptWinDashboard",
      "aiReadinessScore",
      "weeklyScan",
    ],
  },
  growth: {
    id: "growth",
    label: "Growth",
    priceMonthly: 99,
    tagline: "Start winning high-intent AI searches",
    monthlyTokenQuota: 50000,
    maxProductsAnalyzed: 100,
    maxProductsReAnalyze: 5,
    promptsPerProduct: 6,
    manualPromptsPerProduct: 20,
    competitorCount: 3,
    totalTrackedPrompts: Infinity,
    promptTracking: false,
    scanFrequency: "daily",
    dashboardLevel: "full",
    features: [
      "analyze",
      "optimize",
      "applyFixBasic",
      "fixForPrompt",
      "promptWinDashboard",
      "promptWinDashboardFull",
      "aiReadinessScore",
      "promptIntelligence",
      "simulate",
      "competitorGap",
      "monthlyReportExport",
      "weeklyScan",
      "claudeCoverage",
    ],
  },
  pro: {
    id: "pro",
    label: "Pro / Scale",
    priceMonthly: 299,
    tagline: "Own your category in AI recommendations",
    monthlyTokenQuota: Infinity,
    maxProductsAnalyzed: Infinity,
    maxProductsReAnalyze: 10,
    promptsPerProduct: 12,
    manualPromptsPerProduct: 40,
    competitorCount: 5,
    totalTrackedPrompts: Infinity,
    promptTracking: true,
    scanFrequency: "daily",
    dashboardLevel: "advanced",
    features: [
      "analyze",
      "optimize",
      "applyFixBasic",
      "fixForPrompt",
      "promptWinDashboard",
      "promptWinDashboardFull",
      "aiReadinessScore",
      "promptIntelligence",
      "simulate",
      "competitorGap",
      "competitorBenchmark",
      "promptTracking",
      "visibilityTrends",
      "bulkOptimize",
      "whiteLabel",
      "monthlyReportExport",
      "apiAccess",
      "multiStore",
      "weeklyScan",
      "claudeCoverage",
    ],
  },
}

const ADDONS = {
  promptTracking: {
    id: "promptTracking",
    label: "Prompt Tracking",
    priceMonthly: 19,
    description: "Track prompt score changes over time after fixes",
    enablesFeature: "promptTracking",
  },
  aiVisibilityAudit: {
    id: "aiVisibilityAudit",
    label: "AI Visibility Audit",
    priceOneTime: 149,
    description: "Full prompt scan + competitor gap analysis (one-time)",
    enablesFeature: "aiVisibilityAudit",
  },
}

const TOKEN_COSTS = {
  productAnalysis: 100,
  promptSimulation: 50,
  promptIntelligence: 200,
  promptGeneration: 75,
  promptScoring: 25,
}

/** Map legacy plan ids to current config */
function normalizePlan(plan) {
  if (plan === "agency") return "pro"
  return plan || "starter"
}

function getPlanConfig(plan) {
  const key = normalizePlan(plan)
  return PLAN_CONFIG[key] || PLAN_CONFIG.starter
}

function planHasFeature(plan, feature, storeAddons = {}) {
  const config = getPlanConfig(plan)
  if (config.features.includes(feature)) return true

  if (feature === "promptTracking" && storeAddons.promptTracking) return true
  if (feature === "aiVisibilityAudit" && storeAddons.aiVisibilityAudit)
    return true

  return false
}

/**
 * Which AI engines a store's plan is scored/analysed against.
 * chatgpt / perplexity / gemini / aiOverview are available on every plan.
 * claude is Growth+ only (gated via the "claudeCoverage" feature).
 */
function getEnabledEngines(plan, storeAddons = {}) {
  const engines = ["chatgpt", "perplexity", "gemini", "aiOverview"]
  if (planHasFeature(plan, "claudeCoverage", storeAddons)) {
    engines.push("claude")
  }
  return engines
}

function getTokenQuotaForPlan(plan) {
  return getPlanConfig(plan).monthlyTokenQuota
}

function getPromptLimits(plan, storeAddons = {}) {
  const config = getPlanConfig(plan)
  const tracking = config.promptTracking || Boolean(storeAddons.promptTracking)

  return {
    promptsPerProduct: config.promptsPerProduct,
    manualPromptsPerProduct: config.manualPromptsPerProduct ?? 3,
    //autoPromptsOnAnalysis: config.autoPromptsOnAnalysis ?? 3,
    maxProductsAnalyzed: config.maxProductsAnalyzed,
    maxProductsReAnalyze: config.maxProductsReAnalyze ?? 0,
    competitorCount: config.competitorCount ?? 0,
    totalTrackedPrompts: config.totalTrackedPrompts,
    promptTracking: tracking,
    dashboardLevel: config.dashboardLevel,
    scanFrequency: config.scanFrequency,
  }
}

function getAllPlans() {
  return Object.values(PLAN_CONFIG).map((p) => ({
    ...p,
    features: p.features,
  }))
}

function getAllAddons() {
  return Object.values(ADDONS)
}

function scoreToVisibility(score) {
  if (score >= 70) return "HIGH"
  if (score >= 40) return "MEDIUM"
  return "LOW"
}

function visibilityLabel(visibility) {
  switch (visibility) {
    case "HIGH":
      return "You can win"
    case "MEDIUM":
      return "Improve"
    case "LOW":
      return "Missing"
    default:
      return "Unknown"
  }
}

function visibilityMessage(visibility, prompt) {
  switch (visibility) {
    case "HIGH":
      return `You are visible for "${prompt}"`
    case "MEDIUM":
      return `You partially show up for "${prompt}" — room to improve`
    case "LOW":
      return `You are NOT visible for this buying intent: "${prompt}"`
    default:
      return ""
  }
}

export {
  PLAN_CONFIG,
  ADDONS,
  TOKEN_COSTS,
  normalizePlan,
  getPlanConfig,
  planHasFeature,
  getEnabledEngines,
  getTokenQuotaForPlan,
  getPromptLimits,
  getAllPlans,
  getAllAddons,
  scoreToVisibility,
  visibilityLabel,
  visibilityMessage,
}
