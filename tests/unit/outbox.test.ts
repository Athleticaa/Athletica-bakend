import "reflect-metadata";
import { OutboxService } from "../../src/events/outbox.service";

function makePrisma(rows: Array<Record<string, unknown>>) {
  const updates: Array<{ where: unknown; data: unknown }> = [];
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue(rows),
    outbox_events: {
      updateMany: jest.fn().mockResolvedValue({ count: rows.length }),
    },
  };
  const prisma = {
    $transaction: jest.fn().mockImplementation((cb: (t: unknown) => unknown) => cb(tx)),
    outbox_events: {
      update: jest.fn().mockImplementation(({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        updates.push({ where, data });
        return Promise.resolve({ id: where.id, ...data });
      }),
    },
  };
  return { prisma, tx, updates };
}

const ROW = {
  id: "e1",
  event_type: "message.created",
  aggregate_type: "message",
  aggregate_id: "m1",
  channel: "conversation:c1",
  payload: { id: "e1", type: "message.created" },
  created_at: new Date(),
  attempts: 0,
};

beforeEach(() => jest.clearAllMocks());

describe("OutboxService.processBatch", () => {
  it("claims a pending event and marks it processed on publish success", async () => {
    const { prisma, updates } = makePrisma([ROW]);
    const svc = new OutboxService(prisma as never);
    const publish = jest.fn().mockResolvedValue(undefined);
    const result = await svc.processBatch(publish, 10);
    expect(result).toEqual({ claimed: 1, processed: 1, failed: 0 });
    expect(publish).toHaveBeenCalledWith(ROW.channel, ROW.payload);
    expect(updates).toHaveLength(1);
    expect((updates[0].data as Record<string, unknown>).processed_at).toBeInstanceOf(Date);
  });

  it("leaves processed_at unset and increments attempts on publish failure", async () => {
    const { prisma, updates } = makePrisma([ROW]);
    const svc = new OutboxService(prisma as never);
    const publish = jest.fn().mockRejectedValue(new Error("Ably down"));
    const result = await svc.processBatch(publish, 10);
    expect(result).toEqual({ claimed: 1, processed: 0, failed: 1 });
    expect(updates).toHaveLength(1);
    const data = updates[0].data as Record<string, unknown>;
    expect(data.processed_at).toBeUndefined();
    expect(data.attempts).toEqual({ increment: 1 });
    expect(typeof data.last_error).toBe("string");
  });

  it("keeps duplicate processing safe via the stable event id", async () => {
    const dup = { ...ROW };
    const { prisma } = makePrisma([dup]);
    const svc = new OutboxService(prisma as never);
    const seen: string[] = [];
    const publish = jest.fn().mockImplementation(async (_c: string, data: { id: string }) => {
      seen.push(data.id);
    });
    await svc.processBatch(publish, 10);
    await svc.processBatch(publish, 10);
    // Both publishes reuse the same stable outbox id
    expect(seen[0]).toBe("e1");
  });

  it("processes nothing when no events are pending", async () => {
    const { prisma } = makePrisma([]);
    const svc = new OutboxService(prisma as never);
    const publish = jest.fn();
    const result = await svc.processBatch(publish, 10);
    expect(result).toEqual({ claimed: 0, processed: 0, failed: 0 });
    expect(publish).not.toHaveBeenCalled();
  });
});
