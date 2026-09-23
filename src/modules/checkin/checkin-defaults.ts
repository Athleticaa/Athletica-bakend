import { Prisma } from "@prisma/client";

type TxClient = Prisma.TransactionClient;

interface DefaultQuestion {
  question: string;
  type: "NUMBER" | "TEXT" | "SINGLE_CHOICE" | "YES_NO" | "RATING" | "IMAGE";
  options: string[];
  required: boolean;
  order: number;
}

export const DEFAULT_CHECKIN_QUESTIONS: DefaultQuestion[] = [
  // ── Body Measurements ────────────────────────────────────────────
  { question: "Current Weight (kg)",        type: "NUMBER",        options: [],                        required: true, order: 1  },
  { question: "Neck (cm)",                  type: "NUMBER",        options: [],                        required: true, order: 2  },
  { question: "Shoulders (cm)",             type: "NUMBER",        options: [],                        required: true, order: 3  },
  { question: "Chest (cm)",                 type: "NUMBER",        options: [],                        required: true, order: 4  },
  { question: "Right Arm – Flexed (cm)",    type: "NUMBER",        options: [],                        required: true, order: 5  },
  { question: "Left Arm – Flexed (cm)",     type: "NUMBER",        options: [],                        required: true, order: 6  },
  { question: "Waist at Navel (cm)",        type: "NUMBER",        options: [],                        required: true, order: 7  },
  { question: "Hips / Glutes (cm)",         type: "NUMBER",        options: [],                        required: true, order: 8  },
  { question: "Right Thigh (cm)",           type: "NUMBER",        options: [],                        required: true, order: 9  },
  { question: "Left Thigh (cm)",            type: "NUMBER",        options: [],                        required: true, order: 10 },
  { question: "Right Calf (cm)",            type: "NUMBER",        options: [],                        required: true, order: 11 },
  { question: "Left Calf (cm)",             type: "NUMBER",        options: [],                        required: true, order: 12 },

  // ── Progress Photos (optional) ─────────────────────────────────────────
  { question: "Progress Photo – Front",     type: "IMAGE",         options: [],                        required: false, order: 13 },
  { question: "Progress Photo – Side",      type: "IMAGE",         options: [],                        required: false, order: 14 },
  { question: "Progress Photo – Back",      type: "IMAGE",         options: [],                        required: false, order: 15 },

  // ── Monthly Reflection ───────────────────────────────────────────
  {
    question: "How would you rate your overall progress this month? (1–10)",
    type: "RATING", options: [], required: true, order: 16,
  },
  {
    question: "Have you noticed any changes in your body shape this month?",
    type: "YES_NO", options: ["Yes", "No"], required: true, order: 17,
  },
  {
    question: "What is the biggest improvement you noticed this month?",
    type: "TEXT", options: [], required: true, order: 18,
  },
  {
    question: "Did you achieve your main goal for this month?",
    type: "SINGLE_CHOICE", options: ["Yes", "Partially", "No"], required: true, order: 19,
  },
  {
    question: "What was the biggest challenge you faced this month?",
    type: "TEXT", options: [], required: true, order: 20,
  },
  {
    question: "How satisfied are you with your results this month? (1–10)",
    type: "RATING", options: [], required: true, order: 21,
  },
  {
    question: "Do you feel the current training and nutrition plan is working for you?",
    type: "SINGLE_CHOICE", options: ["Yes", "Needs Adjustment"], required: true, order: 22,
  },
  {
    question: "What would you like to improve next month?",
    type: "TEXT", options: [], required: true, order: 23,
  },
  {
    question: "Is there anything you want your coach to know?",
    type: "TEXT", options: [], required: true, order: 24,
  },
];

/**
 * Seeds the default check-in questions for a newly created coach.
 * Must be called inside a Prisma transaction immediately after coach_profiles.create.
 */
export async function createDefaultCheckInQuestions(
  tx: TxClient,
  coachProfileId: string
): Promise<void> {
  await tx.checkin_questions.createMany({
    data: DEFAULT_CHECKIN_QUESTIONS.map((q) => ({
      coach_id:  coachProfileId,
      question:  q.question,
      type:      q.type,
      options:   q.options,
      required:  q.required,
      order:     q.order,
    })),
  });
}
