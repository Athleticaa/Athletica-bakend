const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validateTitle(raw: unknown): string | null {
  if (typeof raw !== "string") return "title_required";
  const str = raw.trim();
  if (str.length === 0) return "title_required";
  if (str.length > 200) return "title_too_long";
  return null;
}

export function validateAchievementId(id: unknown): string | null {
  if (typeof id !== "string" || !UUID_RE.test(id)) return "invalid_uuid";
  return null;
}
