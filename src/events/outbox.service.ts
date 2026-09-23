import { PrismaClient } from "@prisma/client";
import { injectable, inject } from "tsyringe";
import { PrismaClientToken } from "../di/tokens";
import { config } from "../config";
import { publishMessageCreated, MessageCreatedPayload } from "../lib/ably";

export type PublishFn = (channel: string, data: MessageCreatedPayload) => Promise<void>;

interface PendingEventRow {
  id: string;
  event_type: string;
  aggregate_type: string;
  aggregate_id: string;
  channel: string;
  payload: unknown;
  created_at: Date;
  attempts: number;
}

export interface OutboxProcessResult {
  claimed: number;
  processed: number;
  failed: number;
}

function sanitizeError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  // Never persist secrets or message content; keep a bounded reason.
  // The Ably pattern matches "<appId>.<keyName>:<secret>" without baking any
  // deployment-specific key prefix into the source.
  return raw
    .replace(/\b[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}:[A-Za-z0-9_\-+/=]{8,}/g, "[redacted]")
    .replace(/AKIA[^\s"']+/g, "[redacted]")
    .slice(0, 500);
}

// Parallel Ably publishes per batch tick. Serial publishing costs ~1 RTT per
// event (≈50 × 100ms ≈ 5s for a full batch); 5-way parallelism brings the
// worst case comfortably inside serverless function timeouts. Claiming stays
// safe under concurrency via FOR UPDATE SKIP LOCKED + stable event IDs.
const OUTBOX_PUBLISH_CONCURRENCY = 5;

@injectable()
export class OutboxService {
  constructor(@inject(PrismaClientToken) private prisma: PrismaClient) {}

  private defaultPublish: PublishFn = async (channel, data) => {
    await publishMessageCreated(channel, data);
  };

  async processBatch(publish?: PublishFn, batchSize?: number): Promise<OutboxProcessResult> {
    const limit = Math.min(
      Math.max(batchSize ?? config.outbox.batchSize, 1),
      100,
    );
    const doPublish = publish ?? this.defaultPublish;

    // Safe claiming under concurrency: SKIP LOCKED prevents double-claims.
    const claimed = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<PendingEventRow[]>`
        SELECT id, event_type, aggregate_type, aggregate_id, channel, payload, created_at, attempts
        FROM outbox_events
        WHERE processed_at IS NULL
        ORDER BY created_at ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      `;
      if (rows.length === 0) return [];
      const ids = rows.map((r) => r.id);
      await tx.outbox_events.updateMany({
        where: { id: { in: ids } },
        data: { locked_at: new Date() },
      });
      return rows;
    });

    let processed = 0;
    let failed = 0;

    for (let i = 0; i < claimed.length; i += OUTBOX_PUBLISH_CONCURRENCY) {
      const chunk = claimed.slice(i, i + OUTBOX_PUBLISH_CONCURRENCY);
      const outcomes = await Promise.all(
        chunk.map(async (row) => {
          try {
            await doPublish(row.channel, row.payload as MessageCreatedPayload);
            await this.prisma.outbox_events.update({
              where: { id: row.id },
              data: { processed_at: new Date(), locked_at: null, last_error: null },
            });
            return true;
          } catch (err) {
            await this.prisma.outbox_events.update({
              where: { id: row.id },
              data: {
                attempts: { increment: 1 },
                last_error: sanitizeError(err),
                locked_at: null,
              },
            });
            return false;
          }
        }),
      );
      for (const ok of outcomes) {
        if (ok) processed += 1;
        else failed += 1;
      }
    }

    return { claimed: claimed.length, processed, failed };
  }
}
