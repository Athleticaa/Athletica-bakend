import { PrismaClient } from "@prisma/client";
import { injectable, inject } from "tsyringe";
import { v2 as cloudinary } from "cloudinary";
import { PrismaClientToken } from "../../di/tokens";
import { ServiceError } from "../../lib/service-error";
import type { UpdateCoachProfileInput, UpdateClientProfileInput } from "./profile.validation";
import { formatGoal } from "../../lib/format-goal";
import { getSpecializationDisplay } from "./specializations";
import { getGenderGoalQuestionIds } from "../client-questions/gender-goal.util";

export { ServiceError };

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const GENDER_MAP: Record<string, string> = {
  Male: "male",
  Female: "female",
  ذكر: "male",
  أنثى: "female",
};

@injectable()
export class ProfileService {
  constructor(@inject(PrismaClientToken) private prisma: PrismaClient) {}

  async getCoachProfile(userId: string) {
    const user = await this.prisma.users.findUnique({ where: { id: userId } });
    if (!user) throw new ServiceError("user_not_found", 404);

    const profile = await this.prisma.coach_profiles.findFirst({ where: { user_id: userId } });
    if (!profile) throw new ServiceError("coach_profile_not_found", 404);

    const specializationDisplay = getSpecializationDisplay(profile.specialization);

    return {
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        email_verified: user.email_verified,
        created_at: user.created_at,
      },
      profile: {
        id: profile.id,
        bio: profile.bio,
        specialization: profile.specialization,
        specialization_display: specializationDisplay,
        phone_number: profile.phone_number,
        location: profile.location,
        profile_image: profile.profile_image,
      },
    };
  }

  async getClientProfile(userId: string) {
    const user = await this.prisma.users.findUnique({ where: { id: userId } });
    if (!user) throw new ServiceError("user_not_found", 404);

    const profile = await this.prisma.client_profiles.findFirst({ where: { user_id: userId } });
    if (!profile) throw new ServiceError("client_profile_not_found", 404);

    const coachClient = await this.prisma.coach_clients.findFirst({
      where: { client_id: profile.id },
      select: { id: true, created_at: true },
    });

    let workoutPlan = null;
    let nutritionPlan = null;

    if (coachClient) {
      [workoutPlan, nutritionPlan] = await Promise.all([
        this.prisma.workout_plans.findFirst({
          where: { coach_client_id: coachClient.id, is_active: true, deleted_at: null },
          orderBy: { created_at: "desc" },
          select: { id: true, title: true, description: true, is_active: true, created_at: true, start_date: true, cycle_days: true },
        }),
        this.prisma.nutrition_plans.findFirst({
          where: { coach_client_id: coachClient.id, is_active: true },
          orderBy: { created_at: "desc" },
          select: { id: true, title: true, description: true, is_active: true, created_at: true },
        }),
      ]);
    }

    return {
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        email_verified: user.email_verified,
        created_at: user.created_at,
      },
      profile: {
        id: profile.id,
        gender: profile.gender,
        birth_date: profile.birth_date,
        height: profile.height,
        weight: profile.weight,
        goal: formatGoal(profile.goal),
        phone_number: profile.phone_number,
        location: profile.location,
        profile_image: profile.profile_image,
      },
      assigned_at: coachClient?.created_at ?? null,
      workout_plan: workoutPlan,
      nutrition_plan: nutritionPlan,
    };
  }

  private normalizeCoachInput(input: Record<string, unknown>): UpdateCoachProfileInput {
    const out: UpdateCoachProfileInput = {};
    if (input.username !== undefined) out.username = input.username as string;
    if (input.bio !== undefined) out.bio = input.bio as string;
    if (input.specialization !== undefined) out.specialization = input.specialization as string;
    // support camelCase aliases for phone/location
    const phoneRaw = (input as Record<string, unknown>).phone_number ?? (input as Record<string, unknown>).phoneNumber ?? (input as Record<string, unknown>).phone;
    if (phoneRaw !== undefined) out.phone_number = phoneRaw as string;
    const locRaw = (input as Record<string, unknown>).location ?? (input as Record<string, unknown>).Location;
    if (locRaw !== undefined) out.location = locRaw as string;
    return out;
  }

  private normalizeClientInput(input: Record<string, unknown>): UpdateClientProfileInput {
    const out: UpdateClientProfileInput = {};
    if (input.username !== undefined) out.username = input.username as string;
    if (input.gender !== undefined) out.gender = input.gender as string;
    if (input.birth_date !== undefined) out.birth_date = input.birth_date as string;
    // support birthDate camelCase
    else if ((input as Record<string, unknown>).birthDate !== undefined) out.birth_date = (input as Record<string, unknown>).birthDate as string;
    if (input.height !== undefined) out.height = input.height as number;
    if (input.weight !== undefined) out.weight = input.weight as number;
    if (input.goal !== undefined) out.goal = input.goal as string;
    const phoneRaw = (input as Record<string, unknown>).phone_number ?? (input as Record<string, unknown>).phoneNumber ?? (input as Record<string, unknown>).phone;
    if (phoneRaw !== undefined) out.phone_number = phoneRaw as string;
    const locRaw = (input as Record<string, unknown>).location ?? (input as Record<string, unknown>).Location;
    if (locRaw !== undefined) out.location = locRaw as string;
    return out;
  }

  async updateCoachProfile(userId: string, input: UpdateCoachProfileInput) {
    const normalized = this.normalizeCoachInput(input as unknown as Record<string, unknown>);
    const profile = await this.prisma.coach_profiles.findFirst({ where: { user_id: userId } });
    if (!profile) throw new ServiceError("coach_profile_not_found", 404);

    const data: Record<string, unknown> = {};
    if (normalized.bio !== undefined) data.bio = normalized.bio;
    if (normalized.specialization !== undefined) data.specialization = normalized.specialization;
    if (normalized.phone_number !== undefined) {
      const trimmed = (normalized.phone_number as string).trim();
      data.phone_number = trimmed === "" ? null : trimmed;
    }
    if (normalized.location !== undefined) {
      const trimmed = (normalized.location as string).trim();
      data.location = trimmed === "" ? null : trimmed;
    }

    const hasProfileFields = Object.keys(data).length > 0;
    const hasUsername = normalized.username !== undefined;

    if (!hasProfileFields && !hasUsername) throw new ServiceError("no_fields_to_update", 400);

    if (hasUsername) {
      const trimmed = (normalized.username as string).trim();
      const existing = await this.prisma.users.findFirst({
        where: { username: trimmed, id: { not: userId } },
      });
      if (existing) throw new ServiceError("username_already_taken", 409);
    }

    const { freshUser, freshProfile } = await this.prisma.$transaction(async (tx) => {
      if (hasUsername) {
        const trimmed = (normalized.username as string).trim();
        try {
          await tx.users.update({ where: { id: userId }, data: { username: trimmed } });
        } catch (e: unknown) {
          const code = (e as { code?: string })?.code;
          if (code === "P2002") throw new ServiceError("username_already_taken", 409);
          throw e;
        }
      }
      if (hasProfileFields) {
        await tx.coach_profiles.update({ where: { id: profile.id }, data });
      }
      const freshUser = await tx.users.findUnique({ where: { id: userId } });
      if (!freshUser) throw new ServiceError("user_not_found", 404);
      const freshProfile = await tx.coach_profiles.findUnique({ where: { id: profile.id } });
      if (!freshProfile) throw new ServiceError("coach_profile_not_found", 404);
      return { freshUser, freshProfile };
    });

    const specializationDisplay = getSpecializationDisplay(freshProfile.specialization);

    // Return like GET: { user, profile } with all fields
    return {
      user: {
        id: freshUser.id,
        username: freshUser.username,
        email: freshUser.email,
        role: freshUser.role,
        email_verified: freshUser.email_verified,
        created_at: freshUser.created_at,
      },
      profile: {
        id: freshProfile.id,
        bio: freshProfile.bio,
        specialization: freshProfile.specialization,
        specialization_display: specializationDisplay,
        phone_number: freshProfile.phone_number,
        location: freshProfile.location,
        profile_image: freshProfile.profile_image,
      },
    };
  }

  async updateClientProfile(userId: string, input: UpdateClientProfileInput) {
    const normalized = this.normalizeClientInput(input as unknown as Record<string, unknown>);
    const profile = await this.prisma.client_profiles.findFirst({ where: { user_id: userId } });
    if (!profile) throw new ServiceError("client_profile_not_found", 404);

    const data: Record<string, unknown> = {};
    if (normalized.gender !== undefined) {
      const normalizedGender = this.normalizeGender(normalized.gender as string);
      data.gender = normalizedGender ?? normalized.gender;
    }
    if (normalized.birth_date !== undefined) data.birth_date = new Date(normalized.birth_date as string);
    if (normalized.height !== undefined) data.height = normalized.height;
    if (normalized.weight !== undefined) data.weight = normalized.weight;
    if (normalized.goal !== undefined) data.goal = normalized.goal;
    if (normalized.phone_number !== undefined) {
      const trimmed = (normalized.phone_number as string).trim();
      data.phone_number = trimmed === "" ? null : trimmed;
    }
    if (normalized.location !== undefined) {
      const trimmed = (normalized.location as string).trim();
      data.location = trimmed === "" ? null : trimmed;
    }

    const hasProfileFields = Object.keys(data).length > 0;
    const hasUsername = normalized.username !== undefined;

    if (!hasProfileFields && !hasUsername) throw new ServiceError("no_fields_to_update", 400);

    if (hasUsername) {
      const trimmed = (normalized.username as string).trim();
      const existing = await this.prisma.users.findFirst({
        where: { username: trimmed, id: { not: userId } },
      });
      if (existing) throw new ServiceError("username_already_taken", 409);
    }

    const hasGenderSync = normalized.gender !== undefined;
    const genderToSync = hasGenderSync ? ((data.gender as string) ?? (normalized.gender as string)) : null;

    const { freshUser, freshProfile } = await this.prisma.$transaction(async (tx) => {
      if (hasUsername) {
        const trimmed = (normalized.username as string).trim();
        try {
          await tx.users.update({ where: { id: userId }, data: { username: trimmed } });
        } catch (e: unknown) {
          const code = (e as { code?: string })?.code;
          if (code === "P2002") throw new ServiceError("username_already_taken", 409);
          throw e;
        }
      }
      let prof = profile;
      if (hasProfileFields) {
        prof = await tx.client_profiles.update({ where: { id: profile.id }, data });
        if (hasGenderSync && genderToSync) {
          // Run gender sync inside transaction context but using tx prisma
          // We delegate to a tx-aware sync; fallback to non-tx if needed
          await this.syncGenderToAnswersTx(tx as unknown as PrismaClient, prof.id, genderToSync).catch(() => {});
        }
      }
      const freshUser = await tx.users.findUnique({ where: { id: userId } });
      if (!freshUser) throw new ServiceError("user_not_found", 404);
      const freshProfile = await tx.client_profiles.findUnique({ where: { id: profile.id } });
      if (!freshProfile) throw new ServiceError("client_profile_not_found", 404);
      return { freshUser, freshProfile };
    });

    // Return like GET: { user, profile } with all fields
    return {
      user: {
        id: freshUser.id,
        username: freshUser.username,
        email: freshUser.email,
        role: freshUser.role,
        email_verified: freshUser.email_verified,
        created_at: freshUser.created_at,
      },
      profile: {
        id: freshProfile.id,
        gender: freshProfile.gender,
        birth_date: freshProfile.birth_date,
        height: freshProfile.height,
        weight: freshProfile.weight,
        goal: formatGoal(freshProfile.goal),
        phone_number: freshProfile.phone_number,
        location: freshProfile.location,
        profile_image: freshProfile.profile_image,
      },
    };
  }

  private async syncGenderToAnswersTx(tx: PrismaClient, clientId: string, gender: string): Promise<void> {
    const normalized = gender.toLowerCase().trim();
    if (!["male", "female"].includes(normalized)) return;
    const { genderIds, genderChoices } = await getGenderGoalQuestionIds(tx);
    if (genderIds.size === 0) return;
    const existingAnswers = await tx.client_answers.findMany({
      where: { client_id: clientId, question_id: { in: [...genderIds] } },
    });
    if (existingAnswers.length > 0) {
      for (const ans of existingAnswers) {
        const choices = genderChoices.get(ans.question_id);
        if (!choices) continue;
        const newIdx = this.findGenderChoiceIndex(choices, normalized);
        if (newIdx !== null && String(newIdx) !== ans.answer) {
          await tx.client_answers.update({ where: { id: ans.id }, data: { answer: String(newIdx) } });
        }
      }
    } else {
      const firstQuestionId = [...genderIds][0];
      const choices = genderChoices.get(firstQuestionId);
      if (!choices) return;
      const newIdx = this.findGenderChoiceIndex(choices, normalized);
      if (newIdx === null) return;
      await tx.client_answers.create({ data: { client_id: clientId, question_id: firstQuestionId, answer: String(newIdx) } }).catch(() => {});
    }
  }

  private async syncGenderToAnswers(clientId: string, gender: string): Promise<void> {
    const normalized = gender.toLowerCase().trim();
    // Only sync canonical genders
    if (!["male", "female"].includes(normalized)) return;

    const { genderIds, genderChoices } = await getGenderGoalQuestionIds(this.prisma);
    if (genderIds.size === 0) return;

    // Find existing answers for this client for any gender question
    const existingAnswers = await this.prisma.client_answers.findMany({
      where: { client_id: clientId, question_id: { in: [...genderIds] } },
    });

    if (existingAnswers.length > 0) {
      // Update each existing gender answer to the new gender's choice index
      for (const ans of existingAnswers) {
        const choices = genderChoices.get(ans.question_id);
        if (!choices) continue;
        const newIdx = this.findGenderChoiceIndex(choices, normalized);
        if (newIdx !== null && String(newIdx) !== ans.answer) {
          await this.prisma.client_answers.update({
            where: { id: ans.id },
            data: { answer: String(newIdx) },
          });
        }
      }
    } else {
      // No existing gender answer — create one for the first available gender question
      const firstQuestionId = [...genderIds][0];
      const choices = genderChoices.get(firstQuestionId);
      if (!choices) return;
      const newIdx = this.findGenderChoiceIndex(choices, normalized);
      if (newIdx === null) return;
      // Only create if not already exists (unique constraint)
      await this.prisma.client_answers.create({
        data: {
          client_id: clientId,
          question_id: firstQuestionId,
          answer: String(newIdx),
        },
      }).catch(() => {
        // Ignore if race condition creates duplicate
      });
    }
  }

  private findGenderChoiceIndex(choices: string[], normalizedGender: string): number | null {
    for (let i = 0; i < choices.length; i++) {
      const choice = choices[i];
      const mapped = GENDER_MAP[choice] ?? choice.toLowerCase().trim();
      if (mapped === normalizedGender) return i;
    }
    return null;
  }

  private normalizeGender(value: string): string {
    const trimmed = value.trim();
    if (GENDER_MAP[trimmed]) return GENDER_MAP[trimmed];
    const lower = trimmed.toLowerCase();
    if (["male", "female", "unspecified", "other"].includes(lower)) return lower;
    return lower;
  }

  async uploadCoachProfileImage(userId: string, file: Express.Multer.File) {
    const profile = await this.prisma.coach_profiles.findFirst({ where: { user_id: userId } });
    if (!profile) throw new ServiceError("coach_profile_not_found", 404);

    const result = await new Promise<{ secure_url: string }>((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder: "athletica/profiles", public_id: `coach-${userId}-${Date.now()}` },
        (error, result) => {
          if (error || !result) return reject(error || new Error("Upload failed"));
          resolve({ secure_url: result.secure_url });
        },
      );
      stream.end(file.buffer);
    });

    const updated = await this.prisma.coach_profiles.update({
      where: { id: profile.id },
      data: { profile_image: result.secure_url },
    });

    if (profile.profile_image) {
      const publicId = this.extractPublicId(profile.profile_image);
      if (publicId) {
        await cloudinary.uploader.destroy(publicId).catch(() => {});
      }
    }

    return { profile_image: updated.profile_image };
  }

  async uploadClientProfileImage(userId: string, file: Express.Multer.File) {
    const profile = await this.prisma.client_profiles.findFirst({ where: { user_id: userId } });
    if (!profile) throw new ServiceError("client_profile_not_found", 404);

    const result = await new Promise<{ secure_url: string }>((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder: "athletica/profiles", public_id: `client-${userId}-${Date.now()}` },
        (error, result) => {
          if (error || !result) return reject(error || new Error("Upload failed"));
          resolve({ secure_url: result.secure_url });
        },
      );
      stream.end(file.buffer);
    });

    const updated = await this.prisma.client_profiles.update({
      where: { id: profile.id },
      data: { profile_image: result.secure_url },
    });

    if (profile.profile_image) {
      const publicId = this.extractPublicId(profile.profile_image);
      if (publicId) {
        await cloudinary.uploader.destroy(publicId).catch(() => {});
      }
    }

    return { profile_image: updated.profile_image };
  }

  async deleteCoachProfileImage(userId: string) {
    const profile = await this.prisma.coach_profiles.findFirst({ where: { user_id: userId } });
    if (!profile) throw new ServiceError("coach_profile_not_found", 404);
    if (!profile.profile_image) throw new ServiceError("no_profile_image", 404);

    const publicId = this.extractPublicId(profile.profile_image);
    if (publicId) {
      await cloudinary.uploader.destroy(publicId).catch(() => {});
    }

    await this.prisma.coach_profiles.update({
      where: { id: profile.id },
      data: { profile_image: null },
    });

    return { message: "profile_image_deleted" };
  }

  async deleteClientProfileImage(userId: string) {
    const profile = await this.prisma.client_profiles.findFirst({ where: { user_id: userId } });
    if (!profile) throw new ServiceError("client_profile_not_found", 404);
    if (!profile.profile_image) throw new ServiceError("no_profile_image", 404);

    const publicId = this.extractPublicId(profile.profile_image);
    if (publicId) {
      await cloudinary.uploader.destroy(publicId).catch(() => {});
    }

    await this.prisma.client_profiles.update({
      where: { id: profile.id },
      data: { profile_image: null },
    });

    return { message: "profile_image_deleted" };
  }

  private extractPublicId(url: string): string | null {
    const match = url.match(/\/v\d+\/(.+)\.\w+$/);
    return match ? match[1] : null;
  }
}
