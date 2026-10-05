import { App, cert, initializeApp } from "firebase-admin";
import {
  Messaging,
  getMessaging as getAdminMessaging,
} from "firebase-admin/messaging";

let app: App | null = null;
let initialized = false;

/** Test hook: override the messaging client (set back to `undefined` to restore real init). */
let messagingOverride: Messaging | null | undefined = undefined;
export function setMessagingForTests(
  messaging: Messaging | null | undefined,
): void {
  messagingOverride = messaging;
}

function init(): App | null {
  if (initialized) return app;
  initialized = true;

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;

  if (!projectId || !clientEmail || !privateKey) {
    console.warn("[firebase] missing env vars — push notifications disabled");
    return null;
  }

  try {
    app = initializeApp({
      credential: cert({
        projectId,
        clientEmail,
        privateKey: privateKey.replace(/\\n/g, "\n"),
      }),
    });
    return app;
  } catch (err) {
    console.error(
      "[firebase] init failed:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

export function getFirebaseApp(): App | null {
  return init();
}

export function getMessaging(): Messaging | null {
  if (messagingOverride !== undefined) return messagingOverride;
  const a = init();
  return a ? getAdminMessaging(a) : null;
}
