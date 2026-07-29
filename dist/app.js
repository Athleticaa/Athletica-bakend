"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
require("reflect-metadata");
require("./container");
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
require("./lib/i18n");
const i18n_1 = require("./middleware/i18n");
const auth_routes_1 = __importDefault(require("./modules/auth/auth.routes"));
const client_questions_routes_1 = __importDefault(require("./modules/client-questions/client-questions.routes"));
const app = (0, express_1.default)();
app.use((0, helmet_1.default)());
app.use((0, cors_1.default)());
app.use(express_1.default.json());
app.use(i18n_1.i18nMiddleware);
app.use("/auth", auth_routes_1.default);
app.use("/client", client_questions_routes_1.default);
app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
});
exports.default = app;
//# sourceMappingURL=app.js.map