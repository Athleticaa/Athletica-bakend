"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.i18nMiddleware = i18nMiddleware;
const i18n_1 = __importDefault(require("../lib/i18n"));
const SUPPORTED = ["en", "ar"];
function i18nMiddleware(req, _res, next) {
    const header = req.headers["accept-language"] || "en";
    const lang = SUPPORTED.find((l) => header.startsWith(l)) || "en";
    req.language = lang;
    req.t = (key) => i18n_1.default.t(key, { lng: lang });
    next();
}
//# sourceMappingURL=i18n.js.map