"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const i18next_1 = __importDefault(require("i18next"));
const en_json_1 = __importDefault(require("../locales/en.json"));
const ar_json_1 = __importDefault(require("../locales/ar.json"));
i18next_1.default.init({
    resources: {
        en: { translation: en_json_1.default },
        ar: { translation: ar_json_1.default },
    },
    fallbackLng: "en",
    returnObjects: true,
});
exports.default = i18next_1.default;
//# sourceMappingURL=i18n.js.map