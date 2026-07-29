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
exports.ClientQuestionsController = void 0;
const tsyringe_1 = require("tsyringe");
const client_questions_service_1 = require("./client-questions.service");
const validation = __importStar(require("./client-questions.validation"));
let ClientQuestionsController = class ClientQuestionsController {
    service;
    constructor() {
        this.service = tsyringe_1.container.resolve(client_questions_service_1.ClientQuestionsService);
    }
    handleError(res, err) {
        if (err instanceof client_questions_service_1.ServiceError) {
            const t = res.req.t || ((s) => s);
            res.status(err.statusCode).json({ error: t(err.messageKey) });
            return;
        }
        console.error("unexpected error:", err);
        const t = res.req.t || ((s) => s);
        res.status(500).json({ error: t("internal_server_error") });
    }
    getQuestions = async (req, res) => {
        try {
            const questions = await this.service.getQuestions(req.language);
            res.status(200).json({ questions });
        }
        catch (err) {
            this.handleError(res, err);
        }
    };
    getAnswers = async (req, res) => {
        try {
            const clientId = await this.service.getClientProfileId(req.user.sub);
            const answers = await this.service.getAnswers(clientId, req.language);
            res.status(200).json({ answers });
        }
        catch (err) {
            this.handleError(res, err);
        }
    };
    createAnswers = async (req, res) => {
        const errors = validation.validateSubmitAnswers(req.body, req.t);
        if (errors.length > 0) {
            res.status(400).json({ error: req.t("validation_failed"), details: errors });
            return;
        }
        try {
            const clientId = await this.service.getClientProfileId(req.user.sub);
            await this.service.createAnswers(clientId, req.body.answers);
            res.status(201).json({ message: req.t("answers_created") });
        }
        catch (err) {
            this.handleError(res, err);
        }
    };
    updateAnswers = async (req, res) => {
        const errors = validation.validateUpdateAnswers(req.body, req.t);
        if (errors.length > 0) {
            res.status(400).json({ error: req.t("validation_failed"), details: errors });
            return;
        }
        try {
            const clientId = await this.service.getClientProfileId(req.user.sub);
            await this.service.updateAnswers(clientId, req.body.answers);
            res.status(200).json({ message: req.t("answers_updated") });
        }
        catch (err) {
            this.handleError(res, err);
        }
    };
};
exports.ClientQuestionsController = ClientQuestionsController;
exports.ClientQuestionsController = ClientQuestionsController = __decorate([
    (0, tsyringe_1.injectable)(),
    __metadata("design:paramtypes", [])
], ClientQuestionsController);
//# sourceMappingURL=client-questions.controller.js.map