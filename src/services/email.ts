import { Resend } from "resend";
import { injectable } from "tsyringe";
import i18next from "../lib/i18n";

@injectable()
export class EmailService {
  private resend: Resend | null;

  constructor() {
    const apiKey = process.env.RESEND_API_KEY;
    this.resend = apiKey ? new Resend(apiKey) : null;
  }

  private t(lng: string, key: string, options?: Record<string, unknown>): string {
    return i18next.t(key, { lng, ...options }) as string;
  }

  async sendVerificationCode(email: string, code: string, lng = "en"): Promise<void> {
    await this.sendEmail(
      email,
      this.t(lng, "email_subject_verify"),
      this.t(lng, "email_body_verify", { code }),
    );
  }

  async sendPasswordResetCode(email: string, code: string, lng = "en"): Promise<void> {
    await this.sendEmail(
      email,
      this.t(lng, "email_subject_reset"),
      this.t(lng, "email_body_reset", { code }),
    );
  }

  private async sendEmail(to: string, subject: string, html: string): Promise<void> {
    if (!this.resend) return;
    await this.resend.emails.send({
      from: "Acme <onboarding@vibi.social>",
      to,
      subject,
      html,
    });
  }
}
