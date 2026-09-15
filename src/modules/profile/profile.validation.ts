import { isValidSpecialization } from "./specializations";

export interface UpdateCoachProfileInput {
  username?: string;
  bio?: string;
  specialization?: string;
  phone_number?: string;
  location?: string;
}

export interface UpdateClientProfileInput {
  username?: string;
  gender?: string;
  birth_date?: string;
  height?: number;
  weight?: number;
  goal?: string;
  phone_number?: string;
  location?: string;
}

function tFallback(key: string): string {
  return key;
}

export function validateUpdateCoachProfile(
  input: UpdateCoachProfileInput,
  t: (key: string) => string = tFallback,
): string[] {
  const errors: string[] = [];
  if (input.username !== undefined) {
    if (typeof input.username !== "string" || input.username.trim().length < 1 || input.username.trim().length > 100) {
      errors.push(t("username_length"));
    } else if (!/^\p{L}+(?:[ ]+\p{L}+)*$/u.test(input.username.trim())) {
      errors.push(t("username_invalid"));
    }
  }
  if (input.bio !== undefined && (typeof input.bio !== "string" || input.bio.length > 500)) {
    errors.push(t("bio_invalid"));
  }
  if (input.specialization !== undefined && (typeof input.specialization !== "string" || !isValidSpecialization(input.specialization))) {
    errors.push(t("specialization_invalid"));
  }
  if (input.phone_number !== undefined && (typeof input.phone_number !== "string" || input.phone_number.trim().length > 20)) {
    errors.push(t("phone_number_invalid"));
  }
  if (input.location !== undefined && (typeof input.location !== "string" || input.location.trim().length > 100)) {
    errors.push(t("location_invalid"));
  }
  return errors;
}

export function validateUpdateClientProfile(
  input: UpdateClientProfileInput,
  t: (key: string) => string = tFallback,
): string[] {
  const errors: string[] = [];
  if (input.username !== undefined) {
    if (typeof input.username !== "string" || input.username.trim().length < 1 || input.username.trim().length > 100) {
      errors.push(t("username_length"));
    } else if (!/^\p{L}+(?:[ ]+\p{L}+)*$/u.test(input.username.trim())) {
      errors.push(t("username_invalid"));
    }
  }
  if (input.gender !== undefined && typeof input.gender !== "string") {
    errors.push(t("gender_invalid"));
  }
  if (input.birth_date !== undefined) {
    const d = new Date(input.birth_date);
    if (isNaN(d.getTime())) errors.push(t("birth_date_invalid"));
  }
  if (input.height !== undefined && (typeof input.height !== "number" || input.height < 0)) {
    errors.push(t("height_invalid"));
  }
  if (input.weight !== undefined && (typeof input.weight !== "number" || input.weight < 0)) {
    errors.push(t("weight_invalid"));
  }
  if (input.goal !== undefined && (typeof input.goal !== "string" || input.goal.length > 100)) {
    errors.push(t("goal_invalid"));
  }
  if (input.phone_number !== undefined && (typeof input.phone_number !== "string" || input.phone_number.trim().length > 20)) {
    errors.push(t("phone_number_invalid"));
  }
  if (input.location !== undefined && (typeof input.location !== "string" || input.location.trim().length > 100)) {
    errors.push(t("location_invalid"));
  }
  return errors;
}
