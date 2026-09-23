import { timingSafeEqual } from "crypto";
import { Router, Request, Response } from "express";
import { container } from "tsyringe";
import { OutboxService } from "../../events/outbox.service";
import { config } from "../../config";

const router = Router();

function secretsEqual(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

function isAuthorized(req: Request): boolean {
  const expected = process.env.OUTBOX_CRON_SECRET;
  if (!expected) return false;
  const headerSecret = req.headers["x-cron-secret"];
  const headerValue = Array.isArray(headerSecret) ? headerSecret[0] : headerSecret;
  const querySecret =
    typeof req.query.secret === "string"
      ? req.query.secret
      : Array.isArray(req.query.secret)
        ? req.query.secret[0]
        : undefined;
  const bodySecret =
    req.body && typeof req.body.secret === "string" ? (req.body.secret as string) : undefined;
  const provided = headerValue ?? querySecret ?? bodySecret;
  if (typeof provided !== "string" || provided.length === 0) return false;
  return secretsEqual(provided, expected);
}

async function handleProcess(req: Request, res: Response) {
  if (!process.env.OUTBOX_CRON_SECRET) {
    res.status(500).json({ error: req.t("outbox_not_configured") });
    return;
  }
  if (!isAuthorized(req)) {
    res.status(401).json({ error: req.t("unauthorized") });
    return;
  }
  try {
    const service = container.resolve(OutboxService);
    const rawLimit = req.query.limit ?? req.body?.limit;
    let batchSize: number | undefined;
    if (rawLimit !== undefined) {
      const parsed = Number(rawLimit);
      if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 100) {
        batchSize = parsed;
      }
    }
    const result = await service.processBatch(undefined, batchSize ?? config.outbox.batchSize);
    res.status(200).json({ success: true, data: result });
  } catch (err) {
    console.error("outbox process failed:", err);
    res.status(500).json({ error: req.t("internal_server_error") });
  }
}

// Vercel Cron issues GET; manual/ops callers use POST. Both require the secret.
router.get("/process", handleProcess);
router.post("/process", handleProcess);

export default router;
