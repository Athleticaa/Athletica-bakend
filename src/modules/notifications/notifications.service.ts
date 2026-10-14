import { Prisma, PrismaClient } from "@prisma/client";
import { injectable, inject } from "tsyringe";
import { PrismaClientToken } from "../../di/tokens";
import { config } from "../../config";
import { CacheService, CacheHit, cacheKeys, hashQuery } from "../../lib/cache";
import { ServiceError } from "../../lib/service-error";
import {
  NotificationCursor,
  NotificationType,
  encodeNotificationCursor,
  isNotificationType,
} from "./notifications.validation";

import {
  ActorResponse,
  parseActor,
} from "./notification-actor";

export interface CreateNotificationInput {
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, string>;
}

export interface RecipientResponse {
  id: string;
  username: string | null;
  profile_image: string | null;
  role: string | null;
}

export interface NotificationResponse {
  id: string;
  type: string;
  title: string;
  body: string;
  data: Record<string, string>;
  recipient: RecipientResponse | null;
  actor: ActorResponse | null;
  is_read: boolean;
  read_at: Date | null;
  created_at: Date;
}

type NotificationRow = {
  id: string;
  type: string;
  title: string;
  body: string;
  data: unknown;
  is_read: boolean;
  read_at: Date | null;
  created_at: Date;
};

function toResponse(
  row: NotificationRow,
  recipient: RecipientResponse | null = null,
  actor?: ActorResponse | null,
): NotificationResponse {
  const data =
    row.data !== null && typeof row.data === "object" && !Array.isArray(row.data)
      ? (row.data as Record<string, string>)
      : {};
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    data,
    recipient,
    actor: actor === undefined ? parseActor(data) : actor,
    is_read: row.is_read,
    read_at: row.read_at,
    created_at: row.created_at,
  };
}

function sanitizeText(value: string, max: number): string {
  const trimmed = value.trim();
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

@injectable()
export class NotificationsService {
  constructor(@inject(PrismaClientToken) private prisma: PrismaClient) {}

  /**
   * Resolve the recipient's display profile (username, avatar, role) from
   * `users` + the matching coach/client profile. Best-effort: returns null
   * when the lookup fails so reads never break over a profile issue.
   */
  private async resolveRecipient(userId: string): Promise<RecipientResponse | null> {
    try {
      const user = await this.prisma.users.findUnique({
        where: { id: userId },
        select: { id: true, username: true, role: true },
      });
      if (!user) return null;
      let profile_image: string | null = null;
      try {
        if (user.role === "coach") {
          const profile = await this.prisma.coach_profiles.findFirst({
            where: { user_id: userId },
            select: { profile_image: true },
          });
          profile_image = profile?.profile_image ?? null;
        } else if (user.role === "client") {
          const profile = await this.prisma.client_profiles.findFirst({
            where: { user_id: userId },
            select: { profile_image: true },
          });
          profile_image = profile?.profile_image ?? null;
        }
      } catch {
        // Avatar lookup is decorative — keep the username even if it fails.
      }
      return {
        id: user.id,
        username: user.username ?? null,
        profile_image,
        role: user.role ?? null,
      };
    } catch {
      return null;
    }
  }

  /**
   * Persist one inbox row. Best-effort callers catch failures so the domain
   * request never 500s; direct API use surfaces DB errors normally.
   * Titles/bodies are server-rendered snapshots (same strings as FCM tray).
   */
  async create(
    recipientUserId: string,
    input: CreateNotificationInput,
  ): Promise<NotificationResponse> {
    if (!isNotificationType(input.type)) {
      throw new ServiceError("invalid_notification_type", 400);
    }
    const row = await this.prisma.notifications.create({
      data: {
        recipient_user_id: recipientUserId,
        type: input.type,
        title: sanitizeText(input.title, 200),
        body: sanitizeText(input.body, 2000),
        data: (input.data ?? {}) as unknown as Prisma.InputJsonValue,
      },
    });
    const recipient = await this.resolveRecipient(recipientUserId);
    const response = toResponse(row as unknown as NotificationRow, recipient);
    // A new inbox row changes both the list and the badge count.
    await CacheService.delByPrefix(cacheKeys.notificationListPrefix(recipientUserId));
    await CacheService.refresh(cacheKeys.notificationCount(recipientUserId), config.cache.ttlSec.notificationCount, () =>
      this.loadUnreadCount(recipientUserId),
    );
    return response;
  }

  /**
   * List the caller's inbox newest-first. By default (autoRead=true) opening
   * the inbox marks the *returned page* as read (badge clears as items are
   * seen): after the page is fetched, only those row IDs are flipped — never
   * the whole inbox — so a client paginating with `unread_only` still
   * receives later pages. Pass autoRead=false for side-effect-free polling.
   * The mark is best-effort — if it fails the page is returned as stored.
   */
  async list(
    userId: string,
    query: { before?: NotificationCursor; limit: number; unreadOnly: boolean; autoRead?: boolean },
  ): Promise<
    CacheHit<{
      notifications: NotificationResponse[];
      nextCursor: string | undefined;
      hasMore: boolean;
    }>
  > {
    const key = cacheKeys.notificationList(
      userId,
      hashQuery({ limit: query.limit, unreadOnly: query.unreadOnly, autoRead: query.autoRead ?? true, before: query.before ?? null }),
    );
    return CacheService.getOrSet(key, config.cache.ttlSec.notificationList, () =>
      this.loadList(userId, query),
    );
  }

  /**
   * Loader behind the list cache. NOTE: on a cache HIT this whole body is
   * skipped — including the autoRead page-marking below. The served payload
   * is the post-autoRead shape from the MISS, so badge state stays
   * consistent; the mark for newly arrived rows lands on the next MISS
   * (≤30 s). All writers (create/mark*) delete list keys, bounding drift.
   */
  private async loadList(
    userId: string,
    query: { before?: NotificationCursor; limit: number; unreadOnly: boolean; autoRead?: boolean },
  ) {
    const bounded = Math.min(Math.max(query.limit || 20, 1), 50);

    const cursorWhere = query.before
      ? {
          OR: [
            { created_at: { lt: query.before.createdAt } },
            { created_at: query.before.createdAt, id: { lt: query.before.id } },
          ],
        }
      : {};

    const rows = await this.prisma.notifications.findMany({
      where: {
        recipient_user_id: userId,
        ...(query.unreadOnly ? { is_read: false } : {}),
        ...cursorWhere,
      },
      orderBy: [{ created_at: "desc" }, { id: "desc" }],
      take: bounded + 1,
    });

    const hasMore = rows.length > bounded;
    const page = hasMore ? rows.slice(0, bounded) : rows;
    const oldest = page[page.length - 1];
    const nextCursor =
      hasMore && oldest
        ? encodeNotificationCursor({ createdAt: oldest.created_at, id: oldest.id })
        : undefined;

    // Opening the inbox clears the badge for seen items only: mark just the
    // returned page IDs so later pages (e.g. under `unread_only`) survive.
    // Skipped entirely with ?auto_read=false (prefetch/poll clients).
    let autoRead = false;
    if (page.length > 0 && query.autoRead !== false) {
      try {
        await this.prisma.notifications.updateMany({
          where: {
            id: { in: page.map((r) => r.id) },
            recipient_user_id: userId,
            is_read: false,
          },
          data: { is_read: true, read_at: new Date() },
        });
        await CacheService.delByPrefix(cacheKeys.notificationListPrefix(userId));
        await CacheService.refresh(
          cacheKeys.notificationCount(userId),
          config.cache.ttlSec.notificationCount,
          () => this.loadUnreadCount(userId),
        );
        autoRead = true;
      } catch (err) {
        const reason = err instanceof Error ? err.message : "unknown";
        console.error(`[notifications] auto read page failed reason=${reason}`);
      }
    }

    const recipient = await this.resolveRecipient(userId);
    const readAt = new Date();
    return {
      notifications: page.map((r) => {
        const base = toResponse(r as unknown as NotificationRow, recipient);
        return autoRead
          ? { ...base, is_read: true, read_at: base.read_at ?? readAt }
          : base;
      }),
      nextCursor,
      hasMore,
    };
  }

  async unreadCount(userId: string): Promise<CacheHit<number>> {
    return CacheService.getOrSet(
      cacheKeys.notificationCount(userId),
      config.cache.ttlSec.notificationCount,
      () => this.loadUnreadCount(userId),
    );
  }

  private loadUnreadCount(userId: string): Promise<number> {
    return this.prisma.notifications.count({
      where: { recipient_user_id: userId, is_read: false },
    });
  }

  async markRead(userId: string, notificationId: string): Promise<NotificationResponse> {
    const recipient = await this.resolveRecipient(userId);
    const updated = await this.prisma.notifications.updateMany({
      where: { id: notificationId, recipient_user_id: userId, is_read: false },
      data: { is_read: true, read_at: new Date() },
    });
    if (updated.count === 0) {
      // Either missing, belongs to another user, or already read —
      // distinguish missing/foreign (404) from idempotent re-read below.
      const existing = await this.prisma.notifications.findFirst({
        where: { id: notificationId, recipient_user_id: userId },
      });
      if (!existing) throw new ServiceError("notification_not_found", 404);
      return toResponse(existing as unknown as NotificationRow, recipient);
    }
    const row = await this.prisma.notifications.findUnique({
      where: { id: notificationId },
    });
    if (!row) throw new ServiceError("notification_not_found", 404);
    const response = toResponse(row as unknown as NotificationRow, recipient);
    await CacheService.delByPrefix(cacheKeys.notificationListPrefix(userId));
    await CacheService.refresh(cacheKeys.notificationCount(userId), config.cache.ttlSec.notificationCount, () =>
      this.loadUnreadCount(userId),
    );
    return response;
  }

  async markAllRead(userId: string): Promise<{ updated: number }> {
    const result = await this.prisma.notifications.updateMany({
      where: { recipient_user_id: userId, is_read: false },
      data: { is_read: true, read_at: new Date() },
    });
    await CacheService.delByPrefix(cacheKeys.notificationListPrefix(userId));
    await CacheService.refresh(cacheKeys.notificationCount(userId), config.cache.ttlSec.notificationCount, () =>
      this.loadUnreadCount(userId),
    );
    return { updated: result.count };
  }
}
