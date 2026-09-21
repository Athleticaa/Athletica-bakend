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
      this.buildCodeEmail({
        lng,
        preheader: this.t(lng, "email_verify_preheader"),
        badge: this.t(lng, "email_verify_badge"),
        title: this.t(lng, "email_verify_title"),
        message: this.t(lng, "email_verify_message"),
        code,
        expiry: this.t(lng, "email_verify_expiry"),
        ignoreNote: this.t(lng, "email_ignore_note"),
      }),
    );
  }

  async sendPasswordResetCode(email: string, code: string, lng = "en"): Promise<void> {
    await this.sendEmail(
      email,
      this.t(lng, "email_subject_reset"),
      this.buildCodeEmail({
        lng,
        preheader: this.t(lng, "email_reset_preheader"),
        badge: this.t(lng, "email_reset_badge"),
        title: this.t(lng, "email_reset_title"),
        message: this.t(lng, "email_reset_message"),
        code,
        expiry: this.t(lng, "email_reset_expiry"),
        ignoreNote: this.t(lng, "email_ignore_note"),
      }),
    );
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  private buildCodeEmail(opts: {
    lng: string;
    preheader: string;
    badge: string;
    title: string;
    message: string;
    code: string;
    expiry: string;
    ignoreNote: string;
  }): string {
    const isRtl = opts.lng === "ar";
    const dir = isRtl ? "rtl" : "ltr";
    const align = isRtl ? "right" : "left";
    const fontFamily = isRtl
      ? "Tahoma,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"
      : "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
    const footer = this.t(opts.lng, "email_footer");
    const codeLabel = this.t(opts.lng, "email_code_label");

    return `<!doctype html>
<html lang="${opts.lng}" dir="${dir}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${this.escapeHtml(opts.title)}</title>
</head>
<body style="margin:0;padding:0;background-color:#EDEEF1;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${this.escapeHtml(opts.preheader)}</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#EDEEF1;">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width:600px;max-width:600px;background-color:#FFFFFF;border-radius:20px;overflow:hidden;">
<tr><td style="background-color:#0B0B0C;padding:26px 32px;" align="${isRtl ? "right" : "left"}">
<span style="display:inline-block;background-color:#D8FF3E;color:#0B0B0C;font-family:${fontFamily};font-size:18px;font-weight:800;width:36px;height:36px;line-height:36px;text-align:center;border-radius:10px;vertical-align:middle;">A</span>
<span style="font-family:${fontFamily};font-size:19px;font-weight:800;letter-spacing:3px;color:#FFFFFF;vertical-align:middle;">&nbsp;ATHLETICA<span style="color:#D8FF3E;">.</span></span>
</td></tr>
<tr><td style="background-color:#D8FF3E;padding:10px 32px;" align="${isRtl ? "right" : "left"}">
<span style="font-family:${fontFamily};font-size:12px;font-weight:800;letter-spacing:2px;color:#0B0B0C;">${this.escapeHtml(opts.badge)}</span>
</td></tr>
<tr><td style="padding:36px 32px 8px 32px;" align="${align}">
<h1 style="margin:0 0 12px 0;font-family:${fontFamily};font-size:26px;line-height:34px;font-weight:800;color:#0B0B0C;">${this.escapeHtml(opts.title)}</h1>
<p style="margin:0 0 24px 0;font-family:${fontFamily};font-size:15px;line-height:24px;color:#4B5563;">${this.escapeHtml(opts.message)}</p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
<tr><td align="center" style="background-color:#0B0B0C;border-radius:14px;padding:22px 16px;">
<div style="font-family:${fontFamily};font-size:12px;font-weight:700;letter-spacing:3px;color:#9CA3AF;margin-bottom:8px;">${this.escapeHtml(codeLabel)}</div>
<div style="font-family:'Courier New',Courier,monospace;font-size:36px;font-weight:800;letter-spacing:10px;color:#E4FF54;">${this.escapeHtml(opts.code)}</div>
</td></tr>
</table>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
<tr><td align="center" style="padding:18px 0 6px 0;">
<span style="display:inline-block;font-family:${fontFamily};font-size:13px;font-weight:700;color:#92400E;background-color:#FEF3C7;border:1px solid #FDE68A;border-radius:999px;padding:8px 16px;">&#9201;&nbsp; ${this.escapeHtml(opts.expiry)}</span>
</td></tr>
</table>
</td></tr>
<tr><td style="padding:8px 32px 28px 32px;" align="${align}">
<div style="border-top:1px solid #E5E7EB;margin:12px 0 16px 0;"></div>
<p style="margin:0;font-family:${fontFamily};font-size:13px;line-height:20px;color:#9CA3AF;">${this.escapeHtml(opts.ignoreNote)}</p>
</td></tr>
<tr><td style="background-color:#F8F9FA;padding:20px 32px;" align="center">
<p style="margin:0;font-family:${fontFamily};font-size:12px;line-height:18px;color:#9CA3AF;">${this.escapeHtml(footer)}</p>
</td></tr>
</table>
</td></tr></table>
</body>
</html>`;
  }

  private async sendEmail(to: string, subject: string, html: string): Promise<void> {
    if (!this.resend) return;
    await this.resend.emails.send({
      from: process.env.EMAIL_FROM || "Athletica <noreply@athleticaapp.com>",
      to,
      subject,
      html,
    });
  }
}
