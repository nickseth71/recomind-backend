//date window functions

const MS_PER_DAY = 24 * 60 * 60 * 1000

export function normalizeWindowDays(windowDays) {
  const parsed = parseInt(windowDays, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 30
}

export function buildImpactWindows(anchorDate, windowDays = 30, installedAt = null) {
  const anchor = new Date(anchorDate)
  const now = new Date()
  const beforeWindowMs = windowDays * MS_PER_DAY

  const fullBeforeStart = new Date(anchor.getTime() - beforeWindowMs)
  const beforeStart = installedAt
    ? new Date(Math.max(fullBeforeStart.getTime(), new Date(installedAt).getTime()))
    : fullBeforeStart

  const beforeEnd = anchor

  const afterStart = anchor
  const afterEnd = new Date(Math.min(anchor.getTime() + beforeWindowMs, now.getTime()))

  return {
    beforeStart: beforeStart > beforeEnd ? beforeEnd : beforeStart,
    beforeEnd,
    afterStart,
    afterEnd: afterEnd < afterStart ? afterStart : afterEnd,
  }
}

export function hasMinimumElapsed(windowRange, minDays = 3) {
  if (!windowRange || !windowRange.start || !windowRange.end) return false
  return windowRange.end.getTime() - windowRange.start.getTime() >= minDays * MS_PER_DAY
}