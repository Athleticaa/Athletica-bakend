import "reflect-metadata";
import { CheckInService } from "../../src/modules/checkin/checkin.service";

const CLIENT_PROFILE_ID = "c0000000-0000-0000-0000-000000000001";
const COACH_ID = "c0000000-0000-0000-0000-000000000002";
const CC_ID = "c0000000-0000-0000-0000-000000000003";

const QUESTIONS = [
  { id: "q1", coach_id: COACH_ID, question: "Current Weight (kg)", type: "NUMBER", options: [], required: true, order: 1 },
  { id: "q2", coach_id: COACH_ID, question: "Notes?", type: "TEXT", options: [], required: false, order: 2 },
];

function makeService(overrides: {
  coachClientsRow?: object | null;
  pendingRow?: object | null;
  questions?: object[];
}) {
  const mockPrisma: any = {
    coach_clients: {
      findFirst: async () => overrides.coachClientsRow ?? null,
    },
    checkin_assignments: {
      findFirst: async () => overrides.pendingRow ?? null,
    },
    checkin_questions: {
      findMany: async () => overrides.questions ?? QUESTIONS,
    },
  };
  return new CheckInService(mockPrisma);
}

describe("getCoachQuestionsForClient pending gate", () => {
  it("returns questions when a pending assignment exists", async () => {
    const service = makeService({
      coachClientsRow: { id: CC_ID, coach_id: COACH_ID },
      pendingRow: { id: "pending-id" },
    });
    const questions = await service.getCoachQuestionsForClient(CLIENT_PROFILE_ID);
    expect(questions).toEqual(QUESTIONS);
  });

  it("returns [] when there is no pending assignment", async () => {
    const service = makeService({
      coachClientsRow: { id: CC_ID, coach_id: COACH_ID },
      pendingRow: null,
    });
    const questions = await service.getCoachQuestionsForClient(CLIENT_PROFILE_ID);
    expect(questions).toEqual([]);
  });

  it("throws no_coach_assigned when the client has no coach", async () => {
    const service = makeService({ coachClientsRow: null, pendingRow: null });
    await expect(service.getCoachQuestionsForClient(CLIENT_PROFILE_ID)).rejects.toMatchObject({
      messageKey: "no_coach_assigned",
    });
  });
});
