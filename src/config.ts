export const config = {
  invite: {
    ttlMs: 7 * 24 * 60 * 60 * 1000,
    rejectionCooldownMs: 5 * 60 * 1000,
  },
  auth: {
    // Refresh-token lifetime. Rotated on every /auth/refresh use.
    refreshTtlMs: 7 * 24 * 60 * 60 * 1000,
  },
  pagination: {
    maxPageSize: 100,
    defaultPageSize: 20,
  },
  messaging: {
    maxContentLength: 2000,
    defaultLimit: 50,
    maxLimit: 50,
    // Media messaging (009-message-media): per-type caps are enforced in
    // messaging.validation.ts; uploadMaxBytes is the Multer memory ceiling
    // (kept above both caps so rejections carry the specific error key).
    imageMaxBytes: 10 * 1024 * 1024,
    voiceMaxBytes: 25 * 1024 * 1024,
    uploadMaxBytes: 32 * 1024 * 1024,
    allowedImageMimes: ["image/jpeg", "image/png", "image/webp", "image/gif"],
    allowedVoiceMimes: [
      "audio/mpeg",
      "audio/mp4",
      "audio/m4a",
      "audio/ogg",
      "audio/wav",
      "audio/webm",
      "audio/aac",
      "audio/x-m4a",
    ],
    maxVoiceDurationSec: 900,
  },
  realtime: {
    channelPrefix: "conversation",
    eventName: "message.created",
    // Upper bound for the opportunistic post-commit publish. The send request
    // still succeeds when Ably is slow — the outbox cron retries delivery.
    // Awaiting (instead of fire-and-forget) is required on Vercel: the runtime
    // may suspend the function as soon as the response is sent, killing any
    // in-flight background publish.
    publishTimeoutMs: 2500,
  },
  outbox: {
    batchSize: 50,
  },
  push: {
    // Upper bound for a best-effort FCM send. The triggering request still
    // succeeds when FCM is slow — failures are logged, never thrown.
    // Awaiting (instead of fire-and-forget) is required on Vercel: the runtime
    // may suspend the function as soon as the response is sent.
    timeoutMs: 2500,
    // Budget for the Ably presence pre-check before chat-message pushes.
    // Fail-open: on timeout/error the push is sent anyway.
    presenceTimeoutMs: 800,
    // Budget for each bounded best-effort phase preceding a push: recipient
    // resolution lookups, inbox-row persist (+ its recipient enrichment),
    // and PushService's own device-list lookup + dead-token cleanup. On
    // timeout the phase is skipped and the triggering request still
    // succeeds. Worst-case added latency per notify path is therefore
    // bounded: dbLookup + inbox + presence + FCM ≈ 6.3s, and each phase
    // fails safe (skip or fail-open) instead of hanging p99.
    dbLookupTimeoutMs: 1500,
  },
  history: {
    maxDays: 90,
  },
  timezone: "Africa/Cairo",
  appUrl: process.env.APP_URL || "http://localhost:3000",
} as const;
