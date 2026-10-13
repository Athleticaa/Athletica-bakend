/**
 * Race a promise against a timeout. Used to bound best-effort push-notify
 * DB lookups so a slow database cannot inflate p99 on hot request paths
 * (message send, plan assign, check-in submit/assign, coach-request accept).
 * Callers treat rejection as "skip the push"; the triggering request still
 * succeeds. Never swallows the timer: always cleared on settle.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, label = "timeout"): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(label)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  }) as Promise<T>;
}
