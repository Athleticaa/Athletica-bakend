"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.EmailService = void 0;
const resend_1 = require("resend");
const tsyringe_1 = require("tsyringe");
const i18n_1 = __importDefault(require("../lib/i18n"));
let EmailService = class EmailService {
    resend;
    constructor() {
        const apiKey = process.env.RESEND_API_KEY;
        this.resend = apiKey ? new resend_1.Resend(apiKey) : null;
    }
    t(lng, key, options) {
        return i18n_1.default.t(key, { lng, ...options });
    }
    async sendVerificationCode(email, code, lng = "en") {
        await this.sendEmail(email, this.t(lng, "email_subject_verify"), this.t(lng, "email_body_verify", { code }));
    }
    async sendPasswordResetCode(email, code, lng = "en") {
        await this.sendEmail(email, this.t(lng, "email_subject_reset"), this.t(lng, "email_body_reset", { code }));
    }
    async sendEmail(to, subject, html) {
        if (!this.resend)
            return;
        await this.resend.emails.send({
            from: "Acme <onboarding@vibi.social>",
            to,
            subject,
            html,
        });
    }
};
exports.EmailService = EmailService;
exports.EmailService = EmailService = __decorate([
    (0, tsyringe_1.injectable)(),
    __metadata("design:paramtypes", [])
], EmailService);
//# sourceMappingURL=email.js.map