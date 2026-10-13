import "reflect-metadata";
import { Prisma } from "@prisma/client";
import { DevicesService } from "../../src/modules/devices/devices.service";
import { validateDeviceIdentifier } from "../../src/modules/devices/devices.validation";
import { ServiceError } from "../../src/lib/service-error";

function p2002() {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "test",
  });
}

const INPUT = {
  fcm_token: "e".repeat(150),
  platform: "android",
  device_id: "123e4567-e89b-12d3-a456-426614174000",
} as const;

function txMocks(impl: {
  deleteMany?: jest.Mock;
  create?: jest.Mock;
  findFirst?: jest.Mock;
}) {
  return {
    user_devices: {
      deleteMany:
        impl.deleteMany ?? jest.fn().mockResolvedValue({ count: 0 }),
      create:
        impl.create ??
        jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({ id: "dev-1", ...data }),
        ),
      findFirst: impl.findFirst ?? jest.fn().mockResolvedValue(null),
    },
  };
}

describe("DevicesService.register single-device rule", () => {
  it("replaces the previous row for the same user (reinstall, new device_id)", async () => {
    const deleteMany = jest
      .fn()
      .mockResolvedValueOnce({ count: 0 }) // same-token rows under other users
      .mockResolvedValueOnce({ count: 1 }); // previous row for this user
    const tx = txMocks({
      deleteMany,
      findFirst: jest.fn().mockResolvedValue({ device_id: "old-device-id" }),
    });
    const prisma = {
      $transaction: jest.fn().mockImplementation((cb: (t: unknown) => unknown) => cb(tx)),
    };
    const svc = new DevicesService(prisma as never);
    const out = await svc.register("u1", {
      ...INPUT,
      device_id: "99999999-9999-4999-8999-999999999999",
    });
    // Previous row dropped; single fresh row created with replaced=true.
    expect(deleteMany).toHaveBeenCalledWith({ where: { user_id: "u1" } });
    expect(tx.user_devices.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ user_id: "u1", is_active: true }),
    });
    expect(out).toMatchObject({ id: "dev-1", replaced: true });
  });

  it("returns replaced=false on first registration", async () => {
    const prisma = {
      $transaction: jest.fn().mockImplementation((cb: (t: unknown) => unknown) => cb(txMocks({}))),
    };
    const svc = new DevicesService(prisma as never);
    const out = await svc.register("u1", { ...INPUT });
    expect(out).toMatchObject({ replaced: false, is_active: true });
  });

  it("returns replaced=false on routine token refresh (same device_id)", async () => {
    const tx = txMocks({
      findFirst: jest.fn().mockResolvedValue({ device_id: INPUT.device_id }),
    });
    const prisma = {
      $transaction: jest.fn().mockImplementation((cb: (t: unknown) => unknown) => cb(tx)),
    };
    const svc = new DevicesService(prisma as never);
    const out = await svc.register("u1", { ...INPUT, fcm_token: "f".repeat(150) });
    expect(out).toMatchObject({ replaced: false });
  });

  it("reassigns a token held by another user to the latest registrant", async () => {
    const deleteMany = jest.fn().mockResolvedValue({ count: 1 });
    const tx = txMocks({ deleteMany });
    const prisma = {
      $transaction: jest.fn().mockImplementation((cb: (t: unknown) => unknown) => cb(tx)),
    };
    const svc = new DevicesService(prisma as never);
    await svc.register("u2", { ...INPUT });
    expect(deleteMany).toHaveBeenCalledWith({
      where: { fcm_token: INPUT.fcm_token, NOT: { user_id: "u2" } },
    });
  });
});

describe("DevicesService.register race safety", () => {
  it("retries once on P2002 then succeeds", async () => {
    const create = jest
      .fn()
      .mockRejectedValueOnce(p2002())
      .mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: "dev-1", ...data }),
      );
    const prisma = {
      $transaction: jest.fn().mockImplementation((cb: (t: unknown) => unknown) => cb(txMocks({ create }))),
    };
    const svc = new DevicesService(prisma as never);
    await expect(svc.register("u1", { ...INPUT })).resolves.toMatchObject({ id: "dev-1" });
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
  });

  it("maps a repeated P2002 to device_conflict 409 instead of 500", async () => {
    const prisma = {
      $transaction: jest
        .fn()
        .mockImplementation((cb: (t: unknown) => unknown) =>
          cb(txMocks({ create: jest.fn().mockRejectedValue(p2002()) })),
        ),
    };
    const svc = new DevicesService(prisma as never);
    const err = await svc.register("u1", { ...INPUT }).catch((e) => e);
    expect(err).toBeInstanceOf(ServiceError);
    expect((err as ServiceError).messageKey).toBe("device_conflict");
    expect((err as ServiceError).statusCode).toBe(409);
  });

  it("does not swallow non-P2002 failures", async () => {
    const boom = new Error("connection timeout");
    const prisma = {
      $transaction: jest.fn().mockRejectedValue(boom),
    };
    const svc = new DevicesService(prisma as never);
    await expect(svc.register("u1", { ...INPUT })).rejects.toBe(boom);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});

describe("DevicesService.deleteForLogout identifier handling", () => {
  function makeService() {
    const deleteMany = jest.fn().mockResolvedValue({ count: 1 });
    const prisma = { user_devices: { deleteMany } } as never;
    return { svc: new DevicesService(prisma), deleteMany };
  }

  it("deletes by device_id OR fcm_token when both are present", async () => {
    const { svc, deleteMany } = makeService();
    await svc.deleteForLogout("u1", "dev-1", "tok-1");
    expect(deleteMany).toHaveBeenCalledWith({
      where: { user_id: "u1", OR: [{ device_id: "dev-1" }, { fcm_token: "tok-1" }] },
    });
  });

  it("keeps single-identifier and legacy fallbacks scoped to the user", async () => {
    const { svc, deleteMany } = makeService();
    await svc.deleteForLogout("u1", "dev-1");
    expect(deleteMany).toHaveBeenCalledWith({ where: { user_id: "u1", device_id: "dev-1" } });
    await svc.deleteForLogout("u1", undefined, "tok-1");
    expect(deleteMany).toHaveBeenCalledWith({ where: { user_id: "u1", fcm_token: "tok-1" } });
    await svc.deleteForLogout("u1");
    expect(deleteMany).toHaveBeenCalledWith({ where: { user_id: "u1" } });
  });
});
