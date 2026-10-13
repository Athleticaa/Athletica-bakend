import { Prisma, PrismaClient } from "@prisma/client";
import { injectable, inject } from "tsyringe";
import { PrismaClientToken } from "../../di/tokens";
import { ServiceError } from "../../lib/service-error";
import type { RegisterDeviceInput } from "./devices.validation";

export interface DeviceResponse {
  id: string;
  platform: string;
  device_id: string;
  is_active: boolean;
  replaced: boolean;
  last_seen_at: Date;
  created_at: Date;
  updated_at: Date;
}

function toResponse(
  row: {
    id: string;
    platform: string;
    device_id: string;
    is_active: boolean;
    last_seen_at: Date;
    created_at: Date;
    updated_at: Date;
  },
  replaced = false,
): DeviceResponse {
  return {
    id: row.id,
    platform: row.platform,
    device_id: row.device_id,
    is_active: row.is_active,
    replaced,
    last_seen_at: row.last_seen_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

@injectable()
export class DevicesService {
  constructor(@inject(PrismaClientToken) private prisma: PrismaClient) {}

  /**
   * Register or refresh this install's FCM token. Single-device rule: one
   * row per user, newest registration wins — any previous row for this user
   * (e.g. reinstall with a new device_id) is replaced. A token seen under a
   * different user is reassigned here (account switch on the same install).
   * Concurrent registers for the same user can collide on unique(user_id)
   * (P2002): retry once, then surface 409 instead of a raw 500 so the
   * client simply retries. `replaced=true` fires only when the previous
   * row belonged to a *different install* (device_id changed) — routine
   * token refreshes on the same install report `replaced=false` so the app
   * doesn't warn "logged in on another device" on every cold start.
   */
  async register(userId: string, input: RegisterDeviceInput): Promise<DeviceResponse> {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const { row, replaced } = await this.prisma.$transaction(async (tx) => {
          // Token moved to this user: drop the stale row first so the global
          // unique constraint on fcm_token never collides with the create.
          await tx.user_devices.deleteMany({
            where: { fcm_token: input.fcm_token, NOT: { user_id: userId } },
          });

          // Single-device collapse: snapshot the previous row, then drop any
          // previous row for this user.
          const previous = await tx.user_devices.findFirst({
            where: { user_id: userId },
            select: { device_id: true },
          });
          await tx.user_devices.deleteMany({
            where: { user_id: userId },
          });

          const created = await tx.user_devices.create({
            data: {
              user_id: userId,
              fcm_token: input.fcm_token,
              platform: input.platform as string,
              device_id: input.device_id,
              is_active: true,
            },
          });
          return {
            row: created,
            replaced: previous !== null && previous.device_id !== input.device_id,
          };
        });
        return toResponse(row, replaced);
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
          continue;
        }
        throw err;
      }
    }
    console.error(`[devices] register token conflict user=${userId}`);
    throw new ServiceError("device_conflict", 409);
  }

  /**
   * Explicit single-device unregister. Mirrors deleteForLogout's OR logic:
   * when the client sends both identifiers (device_id rotated on reinstall
   * while the token stayed), matching either guarantees the live token row
   * can't survive and keep receiving pushes.
   */
  async unregister(userId: string, deviceId?: string, fcmToken?: string): Promise<void> {
    if (deviceId && fcmToken) {
      await this.prisma.user_devices.deleteMany({
        where: { user_id: userId, OR: [{ device_id: deviceId }, { fcm_token: fcmToken }] },
      });
      return;
    }
    if (deviceId) {
      await this.prisma.user_devices.deleteMany({
        where: { user_id: userId, device_id: deviceId },
      });
      return;
    }
    if (fcmToken) {
      await this.prisma.user_devices.deleteMany({
        where: { user_id: userId, fcm_token: fcmToken },
      });
    }
  }

  /**
   * Refresh last_seen_at for this install. Returns is_active so a client
   * whose token was deactivated (FCM reported not-registered) knows to
   * re-register via POST /devices instead of heartbeating forever with no
   * pushes. Heartbeat never reactivates: only register() (fresh token from
   * the client) may set is_active: true.
   * A device_id that matches no row (stale install, kicked by a newer
   * login under the single-device rule) yields 404 so the client
   * re-registers. Transient DB failures still surface as 500, not 404, or
   * clients would wipe local state during a momentary outage.
   */
  async heartbeat(
    userId: string,
    deviceId: string,
  ): Promise<{ device_id: string; last_seen_at: Date; is_active: boolean }> {
    const existing = await this.prisma.user_devices.findFirst({
      where: { user_id: userId, device_id: deviceId },
      select: { id: true },
    });
    if (!existing) {
      throw new ServiceError("device_not_found", 404);
    }
    try {
      const row = await this.prisma.user_devices.update({
        where: { id: existing.id },
        data: { last_seen_at: new Date() },
        select: { device_id: true, last_seen_at: true, is_active: true },
      });
      return row;
    } catch (err) {
      // Logout deleted the row between the lookup and the update: report
      // 404 (client re-registers) instead of a generic 500. Any other
      // failure (connection loss, pool exhaustion) still surfaces as 500
      // so clients don't wipe local state during a transient DB outage.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
        throw new ServiceError("device_not_found", 404);
      }
      throw err;
    }
  }

  /** Hard-delete device row(s) for logout. Scoped by user_id always. */
  async deleteForLogout(userId: string, deviceId?: string, fcmToken?: string): Promise<void> {
    if (deviceId && fcmToken) {
      // Client sent both identifiers (e.g. device_id rotated on reinstall
      // while the token stayed): match either so the live token row can't
      // survive logout and keep receiving pushes post-logout.
      await this.prisma.user_devices.deleteMany({
        where: { user_id: userId, OR: [{ device_id: deviceId }, { fcm_token: fcmToken }] },
      });
      return;
    }
    if (deviceId) {
      await this.prisma.user_devices.deleteMany({
        where: { user_id: userId, device_id: deviceId },
      });
      return;
    }
    if (fcmToken) {
      await this.prisma.user_devices.deleteMany({
        where: { user_id: userId, fcm_token: fcmToken },
      });
      return;
    }
    // Legacy client sent no identifier: remove everything for this user so no
    // stale token keeps receiving pushes after logout.
    await this.prisma.user_devices.deleteMany({ where: { user_id: userId } });
  }
}
