import { config } from "../config";
import { getAblyRestClient } from "./ably";

export async function isUserInChannel(channel: string, userId: string): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const rest = getAblyRestClient();
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error("presence_timeout")),
        config.push.presenceTimeoutMs,
      );
    });

    const result = await Promise.race([
      rest.channels.get(channel).presence.get({ clientId: userId }),
      timeout,
    ]);

    // Match on clientId explicitly: if Ably ever ignores the filter and
    // returns the full member list, the sender's own presence must not
    // suppress the recipient's push.
    return result.items.some((m: { clientId?: string }) => m?.clientId === userId);
  } catch {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
