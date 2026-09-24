import { PrismaClient } from "@prisma/client";
import { injectable, inject } from "tsyringe";
import { v2 as cloudinary } from "cloudinary";
import { PrismaClientToken } from "../../di/tokens";
import { ServiceError } from "../../lib/service-error";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

@injectable()
export class CoachAchievementsService {
  constructor(@inject(PrismaClientToken) private prisma: PrismaClient) {}

  private async getCoachProfileId(userId: string): Promise<string> {
    const profile = await this.prisma.coach_profiles.findFirst({ where: { user_id: userId } });
    if (!profile) throw new ServiceError("coach_profile_not_found", 404);
    return profile.id;
  }

  private async getClientProfileId(userId: string): Promise<string> {
    const profile = await this.prisma.client_profiles.findFirst({ where: { user_id: userId } });
    if (!profile) throw new ServiceError("client_profile_not_found", 404);
    return profile.id;
  }

  async uploadAchievement(
    userId: string,
    title: string,
    file: Express.Multer.File,
  ) {
    const coachId = await this.getCoachProfileId(userId);
    const trimmedTitle = title.trim();
    // Validation is also done in controller, but keep service guard
    if (trimmedTitle.length === 0) throw new ServiceError("title_required", 400);
    if (trimmedTitle.length > 200) throw new ServiceError("title_too_long", 400);
    if (!file.size) throw new ServiceError("pdf_required", 400);

    // Optional per-coach quota to prevent abuse (Cloudinary quota)
    const MAX_ACHIEVEMENTS = 50;
    const count = await this.prisma.coach_achievements.count({ where: { coach_id: coachId } });
    if (count >= MAX_ACHIEVEMENTS) throw new ServiceError("achievement_limit_reached", 400);

    const result = await new Promise<{ secure_url: string }>((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: "athletica/achievements",
          resource_type: "raw",
          public_id: `coach-${coachId}-${Date.now()}`,
        },
        (error, res) => {
          if (error || !res) return reject(error ?? new Error("Upload failed"));
          resolve({ secure_url: res.secure_url });
        },
      );
      stream.end(file.buffer);
    });

    // If DB create fails after Cloudinary upload, clean up orphan file.
    // Re-check quota inside transaction to reduce race window (count-then-create).
    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const liveCount = await tx.coach_achievements.count({ where: { coach_id: coachId } });
        if (liveCount >= MAX_ACHIEVEMENTS) throw new ServiceError("achievement_limit_reached", 400);
        return tx.coach_achievements.create({
          data: {
            coach_id: coachId,
            title: trimmedTitle,
            file_url: result.secure_url,
            file_name: file.originalname ?? null,
            file_size: file.size ?? null,
            mime_type: file.mimetype ?? "application/pdf",
          },
        });
      });
      return created;
    } catch (e) {
      const publicId = this.extractPublicId(result.secure_url);
      if (publicId) {
        await cloudinary.uploader.destroy(publicId, { resource_type: "raw" }).catch(() => {});
      } else {
        console.warn(`[coach-achievements] upload cleanup: could not extract publicId for ${result.secure_url}`);
      }
      throw e;
    }
  }

  async listMyAchievements(userId: string) {
    const coachId = await this.getCoachProfileId(userId);
    const rows = await this.prisma.coach_achievements.findMany({
      where: { coach_id: coachId },
      orderBy: { created_at: "desc" },
      take: 100,
    });
    return rows;
  }

  async deleteAchievement(userId: string, achievementId: string) {
    const coachId = await this.getCoachProfileId(userId);
    const achievement = await this.prisma.coach_achievements.findUnique({
      where: { id: achievementId },
    });
    if (!achievement || achievement.coach_id !== coachId) {
      throw new ServiceError("achievement_not_found", 404);
    }

    await this.prisma.coach_achievements.delete({ where: { id: achievement.id } });

    // Best-effort Cloudinary cleanup after DB delete (leaked file is recoverable, lost file is not)
    const publicId = this.extractPublicId(achievement.file_url);
    if (publicId) {
      await cloudinary.uploader.destroy(publicId, { resource_type: "raw" }).catch(() => {});
    } else {
      console.warn(`[coach-achievements] delete: could not extract publicId for ${achievement.file_url}`);
    }

    return { message: "achievement_deleted" } as const;
  }

  async listCoachAchievementsForClient(userId: string) {
    const clientProfileId = await this.getClientProfileId(userId);
    const assignment = await this.prisma.coach_clients.findFirst({
      where: { client_id: clientProfileId },
      select: { coach_id: true },
    });
    if (!assignment) throw new ServiceError("no_coach_assigned", 404);

    const rows = await this.prisma.coach_achievements.findMany({
      where: { coach_id: assignment.coach_id },
      orderBy: { created_at: "desc" },
      take: 100,
    });
    return rows;
  }

  private extractPublicId(url: string): string | null {
    try {
      // Cloudinary URL forms:
      // https://res.cloudinary.com/<cloud>/raw/upload/v1234567890/athletica/achievements/coach-xxx-123.pdf
      // https://res.cloudinary.com/<cloud>/raw/upload/athletica/achievements/coach-xxx-123.pdf (no version)
      // We need publicId = folder + filename without extension
      const u = new URL(url);
      const parts = u.pathname.split("/upload/");
      if (parts.length < 2) return null;
      let after = parts[1]; // e.g. v123/athletica/achievements/coach-...pdf  or  athletica/achievements/...
      // Strip version prefix v<digits>/ if present
      after = after.replace(/^v\d+\//, "");
      // Remove query string already handled by URL, just strip extension
      after = after.replace(/\.[^/.]+$/, "");
      return after || null;
    } catch {
      // Fallback to previous regex (handles image-style URLs with extension)
      const match = url.match(/\/v\d+\/(.+)\.\w+$/);
      if (match) return match[1];
      // Generic fallback: take after /upload/
      const idx = url.indexOf("/upload/");
      if (idx === -1) return null;
      let tail = url.slice(idx + "/upload/".length);
      tail = tail.replace(/^v\d+\//, "").split("?")[0];
      tail = tail.replace(/\.[^/.]+$/, "");
      return tail || null;
    }
  }
}
