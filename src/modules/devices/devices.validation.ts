import { isValidUuid } from "../messaging/messaging.validation";

export const DEVICE_PLATFORMS = ["android", "ios", "web"] as const;
export type DevicePlatform = (typeof DEVICE_PLATFORMS)[number];

export interface RegisterDeviceInput {
  fcm_token: string;
  platform: DevicePlatform;
  device_id: string;
}

export interface DeviceIdentifier {
  device_id?: unknown;
  fcm_token?: unknown;
}

const MIN_TOKEN_LENGTH = 100;
const MAX_TOKEN_LENGTH = 4096;

/** Shared with logout validation so a corrupt token can't silently skip cleanup. */
export const FCM_TOKEN_LENGTH = { min: MIN_TOKEN_LENGTH, max: MAX_TOKEN_LENGTH } as const;

export function validatePlatform(value: unknown): value is DevicePlatform {
  return (
    typeof value === "string" &&
    (DEVICE_PLATFORMS as readonly string[]).includes(value)
  );
}

export function validateRegisterDevice(
  body: Partial<RegisterDeviceInput> | undefined,
): { input?: RegisterDeviceInput; errors: string[] } {
  const errors: string[] = [];

  const rawToken = body?.fcm_token;
  const token = typeof rawToken === "string" ? rawToken.trim() : "";
  if (token.length < MIN_TOKEN_LENGTH || token.length > MAX_TOKEN_LENGTH) {
    errors.push("validation_failed");
  }

  if (!validatePlatform(body?.platform)) {
    errors.push("validation_failed");
  }

  if (!isValidUuid(body?.device_id)) {
    errors.push("validation_failed");
  }

  if (errors.length > 0) return { errors };
  return {
    input: {
      fcm_token: token,
      platform: body!.platform as DevicePlatform,
      device_id: body!.device_id as string,
    },
    errors,
  };
}

export function validateDeviceIdentifier(
  body: Partial<DeviceIdentifier> | undefined,
): { device_id?: string; fcm_token?: string; errors: string[] } {
  const errors: string[] = [];

  const rawDeviceId = body?.device_id;
  // Present-but-malformed identifiers are an error even when the other
  // identifier is valid: silently dropping a typo'd device_id would delete
  // by token only, likely not what the caller intended.
  if (
    rawDeviceId !== undefined &&
    rawDeviceId !== null &&
    rawDeviceId !== "" &&
    !isValidUuid(rawDeviceId)
  ) {
    return { errors: ["validation_failed"] };
  }
  const hasDeviceId = isValidUuid(body?.device_id);
  const rawToken = body?.fcm_token;
  const token =
    typeof rawToken === "string" ? rawToken.trim() : "";

  if (!hasDeviceId && token.length === 0) {
    return { errors: ["validation_failed"] };
  }
  if (
    token.length > 0 &&
    (token.length < MIN_TOKEN_LENGTH || token.length > MAX_TOKEN_LENGTH)
  ) {
    errors.push("validation_failed");
  }

  if (errors.length > 0) return { errors };
  return {
    device_id: hasDeviceId ? (body!.device_id as string) : undefined,
    fcm_token: token.length > 0 ? token : undefined,
    errors,
  };
}
