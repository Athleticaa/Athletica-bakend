import { injectable, inject } from "tsyringe";
import { PrismaClient } from "@prisma/client";
import { PrismaClientToken } from "../di/tokens";
import { config } from "../config";
import { getMessaging } from "../lib/firebase";
import { withTimeout } from "../lib/with-timeout";

export interface PushNotification {
  title: string;
  body: string;
  data: Record<string, string>;
}

export interface PushResult {
  sent: number;
  deactivated: number;
  skipped: boolean;
}

const UNREGISTERED_ERRORS = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
]);

function sanitizeError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw
    .replace(/\b[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}:[A-Za-z0-9_\-+/=]{8,}/g, "[redacted]")
    .slice(0, 500);
}

@injectable()
export class PushService {
  constructor(@inject(PrismaClientToken) private prisma: PrismaClient) {}

  async sendToUser(userId: string, notification: PushNotification): Promise<PushResult> {
    const messaging = getMessaging();
    if (!messaging) {
      return { sent: 0, deactivated: 0, skipped: true };
    }

    const devices = await withTimeout(
      this.prisma.user_devices.findMany({
        where: { user_id: userId, is_active: true },
        select: { fcm_token: true },
      }),
      config.push.dbLookupTimeoutMs,
      "push_devices_lookup_timeout",
    ).catch((err) => {
      // A slow DB must not inflate the triggering request's latency past the
      // push budget: skip this send, log, and let the request succeed. The
      // inbox row (written by the caller) still reaches the app on next open.
      const reason = err instanceof Error ? err.message : "unknown";
      console.error(`[push] devices lookup failed user=${userId} reason=${sanitizeError(reason)}`);
      return null;
    });

    if (!devices) {
      return { sent: 0, deactivated: 0, skipped: false };
    }

    if (devices.length === 0) {
      return { sent: 0, deactivated: 0, skipped: false };
    }

    const tokens = devices.map((d) => d.fcm_token);

    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("fcm_timeout")),
          config.push.timeoutMs,
        );
      });

      const response = await Promise.race([
        messaging.sendEachForMulticast({
          tokens,
          notification: { title: notification.title, body: notification.body },
          data: notification.data,
          android: { priority: "high" },
          apns: { headers: { "apns-priority": "10" } },
        }),
        timeout,
      ]);

      let deactivated = 0;
      if (response.responses) {
        const staleTokens = response.responses
          .map((resp, i) => ({ resp, token: tokens[i] }))
          .filter(({ resp }) => resp.error && UNREGISTERED_ERRORS.has(resp.error.code))
          .map(({ token }) => token);
        // One round-trip for all dead tokens instead of awaiting per token.
        // Scoped to this user: a token reassigned to another account between
        // the send and this write must not deactivate the new owner's row.
        // Guarded so a cleanup failure can't zero out a successful send.
        if (staleTokens.length > 0) {
          try {
            await withTimeout(
              Promise.all(
                staleTokens.map((fcm_token) =>
                  this.prisma.user_devices.updateMany({
                    where: { fcm_token, user_id: userId },
                    data: { is_active: false },
                  }),
                ),
              ),
              config.push.dbLookupTimeoutMs,
              "push_deactivate_timeout",
            );
            deactivated = staleTokens.length;
          } catch (err) {
            const reason = err instanceof Error ? err.message : "unknown";
            console.error(`[push] token cleanup failed user=${userId} reason=${sanitizeError(reason)}`);
          }
        }
      }

      return { sent: response.successCount, deactivated, skipped: false };
    } catch (err) {
      const reason = err instanceof Error ? err.message : "unknown";
      console.error(`[push] send failed user=${userId} reason=${sanitizeError(reason)}`);
      return { sent: 0, deactivated: 0, skipped: false };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
