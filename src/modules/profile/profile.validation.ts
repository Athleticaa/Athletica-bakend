export interface UpdateCoachProfileInput {
  bio?: string;
  specialization?: string;
}

export interface UpdateClientProfileInput {
  gender?: string;
  birth_date?: string;
  height?: number;
  weight?: number;
  goal?: string;
}

function tFallback(key: string): string {
  return key;
}

export function validateUpdateCoachProfile(
  input: UpdateCoachProfileInput,
  t: (key: string) => string = tFallback,
): string[] {
  const errors: string[] = [];
  if (input.bio !== undefined && (typeof input.bio !== "string" || input.bio.length > 500)) {
    errors.push(t("bio_invalid"));
  }
  if (input.specialization !== undefined && (typeof input.specialization !== "string" || input.specialization.length > 100)) {
    errors.push(t("specialization_invalid"));
  }
  return errors;
}

export function validateUpdateClientProfile(
  input: UpdateClientProfileInput,
  t: (key: string) => string = tFallback,
): string[] {
  const errors: string[] = [];
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
  return errors;
}
