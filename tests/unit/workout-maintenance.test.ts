import { toTemplateResponse, toTemplateSummaryResponse } from "../../src/modules/workout/workout-template.response-mappers";
import { toPlanResponse } from "../../src/modules/workout/workout-plan.response-mappers";

describe("Workout Maintenance Unit Tests", () => {
  describe("Workout Template Response Mappers", () => {
    it("should calculate correct day_count and exercise_count in summary response", () => {
      const template = {
        id: "template-1",
        title: "Hypertrophy Upper Lower",
        description: "4-day split",
        coach_id: "coach-1",
        created_at: new Date(),
        workout_template_days: [
          {
            id: "day-1",
            title: "Upper A",
            day_number: 1,
            is_rest: false,
            note: "Push focus",
            workout_template_exercises: [{ id: "e1" }, { id: "e2" }, { id: "e3" }],
          },
          {
            id: "day-2",
            title: "Lower A",
            day_number: 2,
            is_rest: false,
            note: "",
            workout_template_exercises: [{ id: "e4" }, { id: "e5" }],
          },
          {
            id: "day-3",
            title: "Rest Day",
            day_number: 3,
            is_rest: true,
            note: "",
            workout_template_exercises: [],
          },
        ],
      };

      const summary = toTemplateSummaryResponse(template);

      expect(summary.day_count).toBe(3);
      expect(summary.exercise_count).toBe(5);
    });

    it("should include note for template days and exercise_count for template detail response", () => {
      const template = {
        id: "template-1",
        title: "Hypertrophy Upper Lower",
        description: "4-day split",
        coach_id: "coach-1",
        deleted_at: null,
        created_at: new Date(),
        workout_template_days: [
          {
            id: "day-1",
            title: "Upper A",
            day_number: 1,
            is_rest: false,
            note: "Focus on chest form",
            workout_template_exercises: [
              {
                id: "te-1",
                exercise_id: "ex-1",
                exercise_order: 1,
                sets: 3,
                reps: 10,
                notes: "RPE 8",
                exercise: { name: "Bench Press" },
              },
            ],
          },
        ],
      };

      const res = toTemplateResponse(template);

      expect(res.day_count).toBe(1);
      expect(res.exercise_count).toBe(1);
      expect(res.days[0].note).toBe("Focus on chest form");
    });
  });

  describe("Workout Plan Response Mappers", () => {
    it("should return note defaulting to empty string in toPlanResponse", () => {
      const plan = {
        id: "plan-1",
        coach_id: "coach-1",
        coach_client_id: "client-1",
        title: "Client Plan 1",
        description: "Description",
        start_date: new Date(),
        cycle_days: 7,
        is_active: true,
        deleted_at: null,
        created_at: new Date(),
        workout_days: [
          {
            id: "day-1",
            title: "Leg Day",
            day_number: 1,
            is_rest: false,
            // note is omitted to test fallback
            workout_day_exercises: [],
          },
          {
            id: "day-2",
            title: "Rest",
            day_number: 2,
            is_rest: true,
            note: "Drink plenty of water",
            workout_day_exercises: [],
          },
        ],
      };

      const res = toPlanResponse(plan);

      expect(res.day_count).toBe(2);
      expect(res.days[0].note).toBe("");
      expect(res.days[1].note).toBe("Drink plenty of water");
    });
  });
});
