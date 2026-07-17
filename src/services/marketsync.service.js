import * as shopifyService from "./shopify.service.js"
import AuditLog from "../models/auditlog.model.js"
import logger from "../config/logger.js"

async function syncStoreMarkets(store) {
  const accessToken = store.accessToken // adjust to your Store model's method
  const fetched = await shopifyService.fetchMarkets(
    store.shopDomain,
    accessToken,
  )

  const existingById = new Map(
    (store.markets || []).map((m) => [m.marketId, m]),
  )
  const newlyEnabled = []

  const merged = fetched.map((live) => {
    const existing = existingById.get(live.marketId)

    const wasEnabled = existing?.enabled ?? false
    const isNowEnabled = live.enabled

    if (isNowEnabled && !wasEnabled) {
      newlyEnabled.push(live)
    }

    return {
      marketId: live.marketId,
      name: live.name,
      enabled: live.enabled,
      primary: live.primary,
      regions: live.regions,
      firstSeenAt: existing?.firstSeenAt ?? new Date(),
      enabledAt: isNowEnabled
        ? (existing?.enabledAt ?? new Date()) // keep original enable date if already known
        : existing?.enabledAt, // preserve historical enabledAt even if disabled again
      lastSyncedAt: new Date(),
    }
  })

  store.markets = merged
  await store.save()

  if (newlyEnabled.length > 0) {
    await AuditLog.create({
      storeId: store._id,
      action: "MARKETS_ENABLED",
      entityType: "store",
      entityId: store._id,
      metadata: {
        markets: newlyEnabled.map((m) => ({ id: m.marketId, name: m.name })),
      },
      performedBy: "marketSync",
    })
    logger.info(
      `${store.shopDomain}: ${newlyEnabled.length} market(s) newly enabled — ${newlyEnabled.map((m) => m.name).join(", ")}`,
    )
  }

  return { markets: merged, newlyEnabled }
}

export { syncStoreMarkets }
