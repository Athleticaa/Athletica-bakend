const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidUuid(value: string): boolean {
  return UUID_REGEX.test(value);
}

export function validateSubmitRequest(
  body: any,
  t: (key: string) => string
): string[] {
  const errors: string[] = [];
  const token = body?.token;

  if (!token || typeof token !== "string" || token.trim().length === 0) {
    errors.push(t("validation_token_required"));
  }

  return errors;
}
