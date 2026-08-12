import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { en, ru, type TranslationKey } from "./messages";

export type AppLocale = "en" | "ru";
export type LanguagePreference = "system" | AppLocale;
type Values = Record<string, string | number | null | undefined>;

const STORAGE_KEY = "webforge.ui.language";
const dictionaries = { en, ru } as const;

export function systemLocale(): AppLocale {
  const value = (navigator.languages?.[0] ?? navigator.language ?? "en").toLowerCase();
  return value.startsWith("ru") ? "ru" : "en";
}

export function storedPreference(): LanguagePreference {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (value === "en" || value === "ru" || value === "system") return value;
  } catch {
    // localStorage is best-effort only.
  }
  return "system";
}

export function resolveInitialLocale(): AppLocale {
  const preference = storedPreference();
  return preference === "system" ? systemLocale() : preference;
}

export function translate(locale: AppLocale, key: TranslationKey, values?: Values): string {
  const template = dictionaries[locale][key] ?? dictionaries.en[key] ?? key;
  if (!values) return template;
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, name: string) => {
    const value = values[name];
    return value === null || value === undefined ? match : String(value);
  });
}

type I18nValue = {
  locale: AppLocale;
  languagePreference: LanguagePreference;
  systemLocale: AppLocale;
  setLanguagePreference: (value: LanguagePreference) => void;
  t: (key: TranslationKey, values?: Values) => string;
};

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [languagePreference, setLanguagePreferenceState] = useState<LanguagePreference>(storedPreference);
  const detected = useMemo(systemLocale, []);
  const locale = languagePreference === "system" ? detected : languagePreference;

  const setLanguagePreference = useCallback((value: LanguagePreference) => {
    setLanguagePreferenceState(value);
    try { localStorage.setItem(STORAGE_KEY, value); } catch { /* best-effort */ }
  }, []);

  const t = useCallback((key: TranslationKey, values?: Values) => translate(locale, key, values), [locale]);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dataset.locale = locale;
  }, [locale]);

  const value = useMemo<I18nValue>(() => ({
    locale,
    languagePreference,
    systemLocale: detected,
    setLanguagePreference,
    t,
  }), [detected, languagePreference, locale, setLanguagePreference, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useI18n must be used inside I18nProvider");
  return value;
}
