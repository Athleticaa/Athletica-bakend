/**
 * Actor snapshot helpers for the notifications inbox.
 *
 * Every non-chat notification stores a snapshot of the *actor* (the user who
 * caused the event) inside the row's `data` JSON so GET responses can render
 * "Coach Ahmed assigned you…" with a name + avatar without extra joins.
 * All values stay strings so the same `data` object remains FCM-safe.
 */

export interface ActorSnapshot {
  userId?: string;
  username?: string;
  profileImage?: string;
  role?: "coach" | "client";
}

export interface ActorResponse {
  user_id: string | null;
  username: string | null;
  profile_image: string | null;
  role: string | null;
}

const DATA_KEYS = {
  userId: "actorUserId",
  username: "actorUsername",
  profileImage: "actorProfileImage",
  role: "actorRole",
} as const;

/** Merge an actor snapshot into an FCM/inbox `data` payload (skips empties). */
export function withActorData(
  data: Record<string, string>,
  actor: ActorSnapshot,
): Record<string, string> {
  const out = { ...data };
  if (actor.userId) out[DATA_KEYS.userId] = actor.userId;
  if (actor.username) out[DATA_KEYS.username] = actor.username;
  if (actor.profileImage) out[DATA_KEYS.profileImage] = actor.profileImage;
  if (actor.role) out[DATA_KEYS.role] = actor.role;
  return out;
}

/** Rebuild the actor display object from a stored `data` payload. */
export function parseActor(data: Record<string, string> | unknown): ActorResponse | null {
  if (data === null || typeof data !== "object" || Array.isArray(data)) return null;
  const d = data as Record<string, unknown>;
  const user_id = typeof d[DATA_KEYS.userId] === "string" ? (d[DATA_KEYS.userId] as string) : null;
  const username = typeof d[DATA_KEYS.username] === "string" ? (d[DATA_KEYS.username] as string) : null;
  const profile_image =
    typeof d[DATA_KEYS.profileImage] === "string" ? (d[DATA_KEYS.profileImage] as string) : null;
  const role = typeof d[DATA_KEYS.role] === "string" ? (d[DATA_KEYS.role] as string) : null;
  if (!user_id && !username && !profile_image) return null;
  return { user_id, username, profile_image, role };
}
