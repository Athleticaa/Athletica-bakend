import { PrismaClient } from "@prisma/client";
import { injectable, inject } from "tsyringe";
import { v2 as cloudinary } from "cloudinary";
import { PrismaClientToken } from "../../di/tokens";
import { ServiceError } from "../../lib/service-error";
import type { UpdateCoachProfileInput, UpdateClientProfileInput } from "./profile.validation";

export { ServiceError };

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

@injectable()
export class ProfileService {
  constructor(@inject(PrismaClientToken) private prisma: PrismaClient) {}

  async getCoachProfile(userId: string) {
    const user = await this.prisma.users.findUnique({ where: { id: userId } });
    if (!user) throw new ServiceError("user_not_found", 404);

    const profile = await this.prisma.coach_profiles.findFirst({ where: { user_id: userId } });
    if (!profile) throw new ServiceError("coach_profile_not_found", 404);

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
        profile_image: profile.profile_image,
      },
    };
  }

  async getClientProfile(userId: string) {
    const user = await this.prisma.users.findUnique({ where: { id: userId } });
    if (!user) throw new ServiceError("user_not_found", 404);

    const profile = await this.prisma.client_profiles.findFirst({ where: { user_id: userId } });
    if (!profile) throw new ServiceError("client_profile_not_found", 404);

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
        goal: profile.goal,
        profile_image: profile.profile_image,
      },
    };
  }

  async updateCoachProfile(userId: string, input: UpdateCoachProfileInput) {
    const profile = await this.prisma.coach_profiles.findFirst({ where: { user_id: userId } });
    if (!profile) throw new ServiceError("coach_profile_not_found", 404);

    const data: Record<string, unknown> = {};
    if (input.bio !== undefined) data.bio = input.bio;
    if (input.specialization !== undefined) data.specialization = input.specialization;

    if (Object.keys(data).length === 0) throw new ServiceError("no_fields_to_update", 400);

    const updated = await this.prisma.coach_profiles.update({ where: { id: profile.id }, data });
    return {
      id: updated.id,
      bio: updated.bio,
      specialization: updated.specialization,
      profile_image: updated.profile_image,
    };
  }

  async updateClientProfile(userId: string, input: UpdateClientProfileInput) {
    const profile = await this.prisma.client_profiles.findFirst({ where: { user_id: userId } });
    if (!profile) throw new ServiceError("client_profile_not_found", 404);

    const data: Record<string, unknown> = {};
    if (input.gender !== undefined) data.gender = input.gender;
    if (input.birth_date !== undefined) data.birth_date = new Date(input.birth_date);
    if (input.height !== undefined) data.height = input.height;
    if (input.weight !== undefined) data.weight = input.weight;
    if (input.goal !== undefined) data.goal = input.goal;

    if (Object.keys(data).length === 0) throw new ServiceError("no_fields_to_update", 400);

    const updated = await this.prisma.client_profiles.update({ where: { id: profile.id }, data });
    return {
      id: updated.id,
      gender: updated.gender,
      birth_date: updated.birth_date,
      height: updated.height,
      weight: updated.weight,
      goal: updated.goal,
      profile_image: updated.profile_image,
    };
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
