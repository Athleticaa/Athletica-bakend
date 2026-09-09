export const SPECIALIZATIONS = {
  general: { en: "General Fitness", ar: "اللياقة العامة" },
  strength_training: { en: "Strength Training", ar: "تدريب القوة" },
  weight_loss: { en: "Weight Loss", ar: "إنقاص الوزن" },
  muscle_building: { en: "Muscle Building", ar: "بناء العضلات" },
  cardio: { en: "Cardio & Endurance", ar: "القلب والتحمل" },
  crossfit: { en: "CrossFit", ar: "كروس فت" },
  bodybuilding: { en: "Bodybuilding", ar: "كمال الأجسام" },
  flexibility: { en: "Flexibility & Mobility", ar: "المرونة والحركة" },
  rehabilitation: { en: "Rehabilitation", ar: "إعادة التأهيل" },
  sports_performance: { en: "Sports Performance", ar: "الأداء الرياضي" },
  nutrition: { en: "Nutrition Coaching", ar: "تدريب التغذية" },
  yoga: { en: "Yoga", ar: "اليوغا" },
  pilates: { en: "Pilates", ar: "بيلاتس" },
  calisthenics: { en: "Calisthenics", ar: "تمارين وزن الجسم" },
  boxing: { en: "Boxing", ar: "الملاكمة" },
  mma: { en: "MMA", ar: "الفنون القتالية المختلطة" },
} as const;

export type SpecializationKey = keyof typeof SPECIALIZATIONS;

export const SPECIALIZATION_KEYS = Object.keys(SPECIALIZATIONS) as SpecializationKey[];

export function isValidSpecialization(value: string): value is SpecializationKey {
  return value in SPECIALIZATIONS;
}

export function getSpecializationDisplay(key: string): { en: string; ar: string } | null {
  const entry = (SPECIALIZATIONS as Record<string, { en: string; ar: string }>)[key];
  return entry ?? null;
}
