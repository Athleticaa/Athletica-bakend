import "reflect-metadata";
import { DevicesService } from "../../src/modules/devices/devices.service";
import { ServiceError } from "../../src/lib/service-error";

function makeService(findFirst: jest.Mock, update: jest.Mock) {
  const prisma = { user_devices: { findFirst, update } } as never;
  return new DevicesService(prisma);
}

describe("DevicesService.heartbeat", () => {
  it("returns is_active alongside device_id and last_seen_at", async () => {
    const row = {
      device_id: "d1",
      last_seen_at: new Date(),
      is_active: true,
    };
    const svc = makeService(
      jest.fn().mockResolvedValue({ id: "row-1" }),
      jest.fn().mockResolvedValue(row),
    );
    await expect(svc.heartbeat("u1", "d1")).resolves.toEqual(row);
  });

  it("surfaces is_active=false so a deactivated client knows to re-register", async () => {
    const row = {
      device_id: "d1",
      last_seen_at: new Date(),
      is_active: false,
    };
    const svc = makeService(
      jest.fn().mockResolvedValue({ id: "row-1" }),
      jest.fn().mockResolvedValue(row),
    );
    const result = await svc.heartbeat("u1", "d1");
    expect(result.is_active).toBe(false);
  });

  it("maps a missing row to device_not_found 404 (kicked/stale install re-registers)", async () => {
    const svc = makeService(
      jest.fn().mockResolvedValue(null),
      jest.fn(),
    );
    const err = await svc.heartbeat("u1", "d1").catch((e) => e);
    expect(err).toBeInstanceOf(ServiceError);
    expect((err as ServiceError).statusCode).toBe(404);
  });

  it("rethrows lookup failures (transient DB errors stay 500, not 404)", async () => {
    const boom = new Error("connection timeout");
    const svc = makeService(jest.fn().mockRejectedValue(boom), jest.fn());
    await expect(svc.heartbeat("u1", "d1")).rejects.toBe(boom);
  });
});
