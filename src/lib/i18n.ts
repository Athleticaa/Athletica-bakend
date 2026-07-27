import i18next from "i18next";
import en from "../locales/en.json";
import ar from "../locales/ar.json";

i18next.init({
  resources: {
    en: { translation: en },
    ar: { translation: ar },
  },
  fallbackLng: "en",
  returnObjects: true,
});

export default i18next;
