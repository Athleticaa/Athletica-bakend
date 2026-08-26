const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidUuid(value: string): boolean {
  return UUID_REGEX.test(value);
}

export function validateSubmitRequest(
  body: any,
  t: (key: string) => string
): string[] {
  const errors: string[] = [];
  const code = body?.code || body?.token;

  if (!code || typeof code !== "string" || code.trim().length === 0) {
    errors.push(t("validation_code_required"));
  } else if (!/^[A-Za-z0-9]{6}$/.test(code.trim())) {
    errors.push(t("validation_code_invalid"));
  }

  return errors;
}
