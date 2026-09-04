/**
 * RecoMind billing plans — aligned with pricing page.
 *
 * Starter  $29/mo  — lead generator, basic visibility
 * Custom   contact us — negotiated pricing and features
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
    maxProductsAnalyzed: Infinity,
    maxProductsReAnalyze: Infinity,
    promptsPerProduct: 3,
    manualPromptsPerProduct: 10,
    competitorCount: 5,
    totalTrackedPrompts: Infinity,
    promptTracking: true,
    scanFrequency: "daily",
    dashboardLevel: "advanced",
    features: [
      "analyze",
      "optimize",
      "promptWinDashboard",
      "promptWinDashboardFull",
      "aiReadinessScore",
      "weeklyScan",
      "fixForPrompt",
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
      "claudeCoverage",
      "manageSyncedProducts",
    ],
    trialDays: 7,
  },
  custom: {
    id: "custom",
    label: "Custom",
    priceMonthly: null,
    tagline: "Contact us for custom pricing and features",
    monthlyTokenQuota: 5000,
    maxProductsAnalyzed: 25,
    maxProductsReAnalyze: 1,
    promptsPerProduct: 3,
    manualPromptsPerProduct: 10,
    competitorCount: 5,
    totalTrackedPrompts: Infinity,
    promptTracking: true,
    scanFrequency: "weekly",
    dashboardLevel: "basic",
    features: [
      "analyze",
      "optimize",
      "promptWinDashboard",
      "promptWinDashboardFull",
      "aiReadinessScore",
      "weeklyScan",
      "fixForPrompt",
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
      "claudeCoverage",
      "manageSyncedProducts",
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
  if (["growth", "pro", "agency"].includes(plan)) return "starter"
  return plan || "starter"
}

function getPlanConfig(plan) {
  const key = normalizePlan(plan)
  return PLAN_CONFIG[key] || PLAN_CONFIG.starter
}

function planHasFeature(plan, feature, storeAddons = {}) {
  const normalizedPlan = normalizePlan(plan)
  if (normalizedPlan === "starter") return true

  const config = getPlanConfig(normalizedPlan)
  if (config.features.includes(feature)) return true

  if (feature === "promptTracking" && storeAddons.promptTracking) return true
  if (feature === "aiVisibilityAudit" && storeAddons.aiVisibilityAudit)
    return true

  return false
}

/**
 * Which AI engines a store's plan is scored/analysed against.
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
  return [PLAN_CONFIG.starter, PLAN_CONFIG.custom].map((p) => ({
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
