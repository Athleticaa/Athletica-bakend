import {
  validateCreateQuestion,
  validateUpdateQuestion,
  validateReorderQuestions,
  validateSubmitCheckIn,
  validateAssignCheckIn,
  isValidUuid,
} from "../../src/modules/checkin/checkin.validation";
import { DEFAULT_CHECKIN_QUESTIONS } from "../../src/modules/checkin/checkin-defaults";

describe("Check-In Validation", () => {
  describe("isValidUuid", () => {
    it("should accept valid UUIDs", () => {
      expect(isValidUuid("c6c59b68-b7c1-4d32-9df7-2c9431e2193b")).toBe(true);
      expect(isValidUuid("00000000-0000-0000-0000-000000000000")).toBe(true);
    });

    it("should reject invalid UUIDs", () => {
      expect(isValidUuid("not-a-uuid")).toBe(false);
      expect(isValidUuid("")).toBe(false);
      expect(isValidUuid("12345")).toBe(false);
    });
  });

  describe("validateCreateQuestion", () => {
    it("should pass for valid question without options", () => {
      const errors = validateCreateQuestion({
        question: "Current Weight (kg)",
        type: "NUMBER",
        required: true,
      });
      expect(errors).toEqual([]);
    });

    it("should pass for valid SINGLE_CHOICE question with options", () => {
      const errors = validateCreateQuestion({
        question: "Did you achieve your goal?",
        type: "SINGLE_CHOICE",
        options: ["Yes", "Partially", "No"],
        required: true,
      });
      expect(errors).toEqual([]);
    });

    it("should require question text", () => {
      const errors = validateCreateQuestion({
        question: "   ",
        type: "TEXT",
      });
      expect(errors).toContain("checkin_question_required");
    });

    it("should reject invalid question type", () => {
      const errors = validateCreateQuestion({
        question: "How are you?",
        type: "MULTI_CHOICE" as any,
      });
      expect(errors).toContain("checkin_question_type_invalid");
    });

    it("should require at least 2 options for SINGLE_CHOICE", () => {
      const errors = validateCreateQuestion({
        question: "Choose one",
        type: "SINGLE_CHOICE",
        options: ["Only one"],
      });
      expect(errors).toContain("checkin_options_required");
    });

    it("should require at least 2 options for YES_NO", () => {
      const errors = validateCreateQuestion({
        question: "Is this correct?",
        type: "YES_NO",
        options: [],
      });
      expect(errors).toContain("checkin_options_required");
    });

    it("should reject options with empty strings", () => {
      const errors = validateCreateQuestion({
        question: "Choose one",
        type: "SINGLE_CHOICE",
        options: ["Option 1", "   "],
      });
      expect(errors).toContain("checkin_options_invalid");
    });

    it("should validate order to be positive integer", () => {
      const errors = validateCreateQuestion({
        question: "Some question",
        type: "TEXT",
        order: 0,
      });
      expect(errors).toContain("checkin_order_invalid");
    });
  });

  describe("validateUpdateQuestion", () => {
    it("should reject empty update request", () => {
      const errors = validateUpdateQuestion({});
      expect(errors).toContain("invalid_request");
    });

    it("should pass with valid partial updates", () => {
      expect(validateUpdateQuestion({ question: "Updated text" })).toEqual([]);
      expect(validateUpdateQuestion({ type: "TEXT" })).toEqual([]);
      expect(validateUpdateQuestion({ required: false })).toEqual([]);
      expect(validateUpdateQuestion({ order: 3 })).toEqual([]);
      expect(validateUpdateQuestion({ options: ["A", "B"] })).toEqual([]);
    });

    it("should reject invalid type in update", () => {
      const errors = validateUpdateQuestion({ type: "INVALID" as any });
      expect(errors).toContain("checkin_question_type_invalid");
    });
  });

  describe("validateReorderQuestions", () => {
    it("should pass for valid array of UUIDs", () => {
      const errors = validateReorderQuestions({
        question_ids: [
          "a0000000-0000-0000-0000-000000000001",
          "a0000000-0000-0000-0000-000000000002",
        ],
      });
      expect(errors).toEqual([]);
    });

    it("should reject empty array", () => {
      const errors = validateReorderQuestions({ question_ids: [] });
      expect(errors).toContain("checkin_question_ids_required");
    });

    it("should reject duplicate UUIDs", () => {
      const id = "a0000000-0000-0000-0000-000000000001";
      const errors = validateReorderQuestions({ question_ids: [id, id] });
      expect(errors).toContain("checkin_duplicate_question_id");
    });

    it("should reject invalid UUID string", () => {
      const errors = validateReorderQuestions({ question_ids: ["invalid-uuid"] });
      expect(errors).toContain("invalid_uuid");
    });
  });

  describe("validateSubmitCheckIn", () => {
    const validQId = "a0000000-0000-0000-0000-000000000001";

    it("should pass for valid submission answers array", () => {
      const errors = validateSubmitCheckIn({
        answers: [{ question_id: validQId, answer_value: "75" }],
      });
      expect(errors).toEqual([]);
    });

    it("should reject empty answers array", () => {
      const errors = validateSubmitCheckIn({ answers: [] });
      expect(errors).toContain("checkin_answers_required");
    });

    it("should reject missing question_id", () => {
      const errors = validateSubmitCheckIn({
        answers: [{ question_id: "invalid", answer_value: "75" }],
      });
      expect(errors.some((e) => e.includes("invalid_uuid"))).toBe(true);
    });

    it("should reject null or undefined answer_value", () => {
      const errors = validateSubmitCheckIn({
        answers: [{ question_id: validQId, answer_value: null as any }],
      });
      expect(errors.some((e) => e.includes("checkin_answer_required"))).toBe(true);
    });
  });

  describe("DEFAULT_CHECKIN_QUESTIONS", () => {
    it("should contain exactly 24 default questions", () => {
      expect(DEFAULT_CHECKIN_QUESTIONS.length).toBe(24);
    });

    it("all default questions should have valid types and sequential orders", () => {
      DEFAULT_CHECKIN_QUESTIONS.forEach((q, index) => {
        expect(q.order).toBe(index + 1);
        expect(q.question.trim().length).toBeGreaterThan(0);
        expect(["NUMBER", "TEXT", "SINGLE_CHOICE", "YES_NO", "RATING", "IMAGE"]).toContain(q.type);
        if (q.type === "SINGLE_CHOICE" || q.type === "YES_NO") {
          expect(q.options.length).toBeGreaterThanOrEqual(2);
        }
      });
    });

    it("progress photos should be optional, everything else required", () => {
      DEFAULT_CHECKIN_QUESTIONS.forEach((q) => {
        if (q.type === "IMAGE") {
          expect(q.required).toBe(false);
        } else {
          expect(q.required).toBe(true);
        }
      });
      expect(DEFAULT_CHECKIN_QUESTIONS.filter((q) => q.type === "IMAGE").length).toBe(3);
    });
  });

  describe("validateAssignCheckIn", () => {
    it("should pass for valid coach_client_id", () => {
      const errors = validateAssignCheckIn({
        coach_client_id: "a0000000-0000-0000-0000-000000000001",
      });
      expect(errors).toEqual([]);
    });

    it("should reject missing coach_client_id", () => {
      const errors = validateAssignCheckIn({});
      expect(errors.some((e) => e.includes("coach_client_id_required"))).toBe(true);
    });

    it("should reject invalid UUID for coach_client_id", () => {
      const errors = validateAssignCheckIn({ coach_client_id: "not-a-uuid" });
      expect(errors.some((e) => e.includes("coach_client_id_required"))).toBe(true);
    });

    it("should reject empty string coach_client_id", () => {
      const errors = validateAssignCheckIn({ coach_client_id: "" });
      expect(errors.some((e) => e.includes("coach_client_id_required"))).toBe(true);
    });
  });
});
