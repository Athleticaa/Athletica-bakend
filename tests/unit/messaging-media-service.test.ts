import type { PrismaClient } from "@prisma/client";
import { v2 as cloudinary } from "cloudinary";
import { resetAblyClient, setAblyRestClient } from "../../src/lib/ably";
import { MessagingService } from "../../src/modules/messaging/messaging.service";

// getAblyRestClient() requires a key before it returns the injected fake.
process.env.ABLY_API_KEY ??= "unit-test-fake-key";

const CONV_ID = "123e4567-e89b-12d3-a456-426614174000";
const MESSAGE_ID = "323e4567-e89b-12d3-a456-426614174000";
const CREATED_AT = new Date("2026-09-30T10:00:00.000Z");

const conversation = {
  id: CONV_ID,
  coach_client_id: "223e4567-e89b-12d3-a456-426614174000",
  coach_id: "coach-profile",
  client_id: "client-profile",
};

const voiceFile = {
  mimetype: "audio/mpeg",
  size: 1024 * 1024,
  buffer: Buffer.from("ID3"),
} as Express.Multer.File;

const imageFile = {
  mimetype: "image/jpeg",
  size: 2048,
  buffer: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
} as Express.Multer.File;

function mockTx(overrides: { createImpl?: (args: unknown) => Promise<unknown> } = {}) {
  const created = {
    id: MESSAGE_ID,
    conversation_id: CONV_ID,
    created_at: CREATED_AT,
  };
  return {
    messages: {
      create: jest.fn(async (args: unknown) => ({ ...created, ...(overrides.createImpl ? await overrides.createImpl(args) : {}) })),
    },
    conversations: { update: jest.fn(async () => conversation) },
    outbox_events: { create: jest.fn(async () => ({ id: "event-1" })) },
  };
}

function mockPrisma(tx: ReturnType<typeof mockTx>, txThrows?: unknown) {
  return {
    coach_profiles: { findFirst: jest.fn(async () => ({ id: "coach-profile" })) },
    client_profiles: { findFirst: jest.fn(async () => ({ id: "client-profile" })) },
    conversations: { findUnique: jest.fn(async () => conversation) },
    coach_clients: { findUnique: jest.fn(async () => ({ id: "assignment" })) },
    $transaction: txThrows
      ? jest.fn(async () => {
          throw txThrows;
        })
      : jest.fn(async (cb: (t: unknown) => Promise<unknown>) => cb(tx)),
  } as unknown as PrismaClient;
}

function mockUploadStream(secureUrl: string) {
  return jest
    .spyOn(cloudinary.uploader, "upload_stream")
    .mockImplementation(((options: unknown, cb: (err: unknown, res?: { secure_url: string }) => void) => {
      return { end: () => cb(null, { secure_url: secureUrl }) };
    }) as never);
}

describe("MessagingService media sends", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    setAblyRestClient(null);
    resetAblyClient();
  });

  it("creates a voice message with media fields and publishes once", async () => {
    const tx = mockTx();
    const service = new MessagingService(mockPrisma(tx));
    const uploadSpy = mockUploadStream("https://mock.cloudinary.com/video/upload/note.mp3");
    const destroySpy = jest.spyOn(cloudinary.uploader, "destroy").mockResolvedValue({} as never);
    const publishFn = jest.fn(async () => {});
    setAblyRestClient({
      channels: { get: () => ({ publish: publishFn }) },
    } as never);

    const { message } = await service.sendMediaMessageToConversation(
      "coach-user",
      "coach",
      CONV_ID,
      { messageType: "voice", content: "cue", durationSec: 187 },
      voiceFile
    );

    expect(message.id).toBe(MESSAGE_ID);
    expect(uploadSpy).toHaveBeenCalledTimes(1);
    const uploadOpts = uploadSpy.mock.calls[0][0] as { resource_type: string };
    expect(uploadOpts.resource_type).toBe("video");
    expect(tx.messages.create).toHaveBeenCalledTimes(1);
    const data = (tx.messages.create.mock.calls[0][0] as { data: Record<string, unknown> }).data;
    expect(data).toMatchObject({
      conversation_id: CONV_ID,
      content: "cue",
      message_type: "voice",
      attachment_url: "https://mock.cloudinary.com/video/upload/note.mp3",
      attachment_mime: "audio/mpeg",
      attachment_size: voiceFile.size,
      attachment_duration_sec: 187,
    });
    expect(tx.outbox_events.create).toHaveBeenCalledTimes(1);
    expect(publishFn).toHaveBeenCalledTimes(1);
    expect(destroySpy).not.toHaveBeenCalled();
  });

  it("uploads images with the image resource type", async () => {
    const tx = mockTx();
    const service = new MessagingService(mockPrisma(tx));
    const uploadSpy = mockUploadStream("https://mock.cloudinary.com/image/upload/pic.jpg");
    setAblyRestClient({
      channels: { get: () => ({ publish: jest.fn(async () => {}) }) },
    } as never);

    await service.sendMediaMessageToConversation(
      "coach-user",
      "coach",
      CONV_ID,
      { messageType: "image", content: null, durationSec: null },
      imageFile
    );

    const uploadOpts = uploadSpy.mock.calls[0][0] as { resource_type: string };
    expect(uploadOpts.resource_type).toBe("image");
  });

  it("destroys the orphan asset and rethrows when the transaction fails", async () => {
    const tx = mockTx();
    const service = new MessagingService(mockPrisma(tx, new Error("db down")));
    mockUploadStream("https://mock.cloudinary.com/video/upload/v7/athletica/messages/msg-x-1.mp3");
    const destroySpy = jest.spyOn(cloudinary.uploader, "destroy").mockResolvedValue({} as never);
    setAblyRestClient({
      channels: { get: () => ({ publish: jest.fn(async () => {}) }) },
    } as never);

    await expect(
      service.sendMediaMessageToConversation(
        "coach-user",
        "coach",
        CONV_ID,
        { messageType: "voice", content: null, durationSec: null },
        voiceFile
      )
    ).rejects.toThrow("db down");
    expect(destroySpy).toHaveBeenCalledTimes(1);
    expect(destroySpy).toHaveBeenCalledWith("athletica/messages/msg-x-1", {
      resource_type: "video",
    });
  });
});
