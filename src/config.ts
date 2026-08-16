export const config = {
  invite: {
    ttlMs: 7 * 24 * 60 * 60 * 1000,
    rejectionCooldownMs: 5 * 60 * 1000,
  },
  pagination: {
    maxPageSize: 100,
    defaultPageSize: 20,
  },
  history: {
    maxDays: 90,
  },
  timezone: "Africa/Cairo",
  appUrl: process.env.APP_URL || "http://localhost:3000",
} as const;
