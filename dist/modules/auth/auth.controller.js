"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthController = void 0;
const tsyringe_1 = require("tsyringe");
const auth_service_1 = require("./auth.service");
const validation = __importStar(require("./auth.validation"));
let AuthController = class AuthController {
    authService;
    constructor() {
        this.authService = tsyringe_1.container.resolve(auth_service_1.AuthService);
    }
    handleError(res, err) {
        if (err instanceof auth_service_1.ServiceError) {
            const t = res.req.t || ((s) => s);
            res.status(err.statusCode).json({ error: t(err.messageKey) });
            return;
        }
        console.error("unexpected error:", err);
        const t = res.req.t || ((s) => s);
        res.status(500).json({ error: t("internal_server_error") });
    }
    signup = async (req, res) => {
        const errors = validation.validateSignup(req.body, req.t);
        if (errors.length > 0) {
            res.status(400).json({ error: req.t("validation_failed"), details: errors });
            return;
        }
        try {
            await this.authService.signup(req.body, req.language);
            res.status(200).json({ message: req.t("code_sent") });
        }
        catch (err) {
            this.handleError(res, err);
        }
    };
    login = async (req, res) => {
        const errors = validation.validateLogin(req.body, req.t);
        if (errors.length > 0) {
            res.status(400).json({ error: req.t("validation_failed"), details: errors });
            return;
        }
        try {
            const result = await this.authService.login(req.body.email, req.body.password);
            res.status(200).json(result);
        }
        catch (err) {
            this.handleError(res, err);
        }
    };
    resetPassword = async (req, res) => {
        const errors = validation.validateResetPassword(req.body, req.t);
        if (errors.length > 0) {
            res.status(400).json({ error: req.t("validation_failed"), details: errors });
            return;
        }
        try {
            await this.authService.requestPasswordReset(req.body.email, req.language);
            res.status(200).json({ message: req.t("reset_link_sent") });
        }
        catch (err) {
            this.handleError(res, err);
        }
    };
    confirmReset = async (req, res) => {
        const errors = validation.validateConfirmReset(req.body, req.t);
        if (errors.length > 0) {
            res.status(400).json({ error: req.t("validation_failed"), details: errors });
            return;
        }
        try {
            await this.authService.confirmPasswordReset(req.body.email, req.body.code, req.body.password);
            res.status(200).json({ message: req.t("password_updated") });
        }
        catch (err) {
            this.handleError(res, err);
        }
    };
    changePassword = async (req, res) => {
        const errors = validation.validateChangePassword(req.body, req.t);
        if (errors.length > 0) {
            res.status(400).json({ error: req.t("validation_failed"), details: errors });
            return;
        }
        try {
            await this.authService.changePassword(req.user.sub, req.body.old_password, req.body.new_password);
            res.status(200).json({ message: req.t("password_updated") });
        }
        catch (err) {
            this.handleError(res, err);
        }
    };
    verifyEmail = async (req, res) => {
        const errors = validation.validateVerifyEmail(req.body, req.t);
        if (errors.length > 0) {
            res.status(400).json({ error: req.t("validation_failed"), details: errors });
            return;
        }
        try {
            const result = await this.authService.verifyEmail(req.body.email, req.body.code);
            res.status(200).json(result);
        }
        catch (err) {
            this.handleError(res, err);
        }
    };
    resendVerification = async (req, res) => {
        const errors = validation.validateResendVerification(req.body, req.t);
        if (errors.length > 0) {
            res.status(400).json({ error: req.t("validation_failed"), details: errors });
            return;
        }
        try {
            await this.authService.resendVerificationCode(req.body.email, req.language);
            res.status(200).json({ message: req.t("code_sent") });
        }
        catch (err) {
            this.handleError(res, err);
        }
    };
    me = (req, res) => {
        res.status(200).json({ user: req.user });
    };
};
exports.AuthController = AuthController;
exports.AuthController = AuthController = __decorate([
    (0, tsyringe_1.injectable)(),
    __metadata("design:paramtypes", [])
], AuthController);
//# sourceMappingURL=auth.controller.js.map