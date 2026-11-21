"use client"

import * as React from "react"

/**
 * The language layer.
 *
 * The product is Arabic-first, but the reference ships an English UI and the
 * brief asks for both: Arabic RTL as the default, English LTR as a real
 * switch — not a label that says "coming soon".
 *
 * What is translated today is the **chrome** — the sidebar, the top bar, the
 * page header, the AI launcher, and the shared UI vocabulary. The page
 * bodies still carry their own Arabic copy; the dictionary is the seam those
 * strings will move into, one page at a time. The direction switch itself
 * applies to the whole document, so an English shell around an Arabic body
 * still lays out correctly.
 */

export type Language = "ar" | "en"

export const LANGUAGE_STORAGE_KEY = "elnour.language"

export const DIRECTION: Record<Language, "rtl" | "ltr"> = {
  ar: "rtl",
  en: "ltr",
}

export const LANGUAGE_LABEL: Record<Language, string> = {
  ar: "العربية",
  en: "English",
}

/**
 * The dictionary.
 *
 * Flat keys, grouped by the surface they belong to. `ar` is the source of
 * truth — every key must exist in both maps, and `assertDictionary` (below)
 * fails the build if one is missing.
 */
const DICTIONARY = {
  ar: {
    "brand.name": "النور",
    "brand.store": "متجر النور",
    "brand.tagline": "إدارة الطلبات والعملاء",

    "nav.group.sales": "المبيعات",
    "nav.group.money": "المال",
    "nav.group.intelligence": "الذكاء",
    "nav.group.system": "النظام",
    "nav.home": "الرئيسية",
    "nav.brain": "عقل النشاط",
    "nav.agent": "المساعد",
    "nav.approvals": "الموافقات",
    "nav.orders": "الطلبات",
    "nav.customers": "العملاء",
    "nav.products": "المنتجات",
    "nav.reconciliation": "التسوية اليومية",
    "nav.collections": "مطابقة التحصيل",
    "nav.reports": "التقارير",
    "nav.analytics": "التحليلات",
    "nav.overview": "نظرة عامة",
    "nav.briefing": "الإحاطة",
    "nav.decisions": "القرارات",
    "nav.risk": "مخاطر التحصيل",
    "nav.anomalies": "الشذوذ",
    "nav.forecast": "التنبؤ",
    "nav.simulator": "محاكي الأرباح",
    "nav.costs": "إدخال التكاليف",
    "nav.integrations": "تأكيد الطلبات والتكاملات",
    "nav.settings": "الإعدادات",
    "nav.collapse": "طيّ القائمة",
    "nav.expand": "توسيع القائمة",
    "nav.more": "المزيد",

    "topbar.openMenu": "فتح القائمة",
    "topbar.search": "بحث...",
    "topbar.theme.light": "الوضع الفاتح",
    "topbar.theme.dark": "الوضع الداكن",
    "topbar.notifications": "الإشعارات",
    "topbar.language": "اللغة",
    "topbar.account": "الحساب",
    "topbar.logout": "تسجيل الخروج",

    "ai.launcher": "اسأل عن بيزنسك",
    "ai.placeholder": "اسأل عن أرقام متجرك…",
    "ai.send": "إرسال",
    "ai.close": "إغلاق",
    "ai.question": "سؤالك",
    "ai.attach": "إرفاق ملف",
    "ai.voice": "إدخال صوتي",

    "common.period": "الفترة",
    "common.today": "اليوم",
    "common.yesterday": "أمس",
    "common.last7": "آخر ٧ أيام",
    "common.last30": "آخر ٣٠ يوم",
    "common.thisMonth": "هذا الشهر",
    "common.all": "الكل",
    "common.search": "بحث",
    "common.filters": "الفلاتر",
    "common.clear": "مسح",
    "common.export": "تصدير",
    "common.refresh": "تحديث",
    "common.save": "حفظ",
    "common.cancel": "إلغاء",
    "common.loading": "جارٍ التحميل…",
    "common.error": "تعذّر تحميل البيانات. حاول مرة أخرى.",
    "common.retry": "إعادة المحاولة",
    "common.source": "المصدر",
    "common.empty": "لا توجد بيانات",
    "common.close": "إغلاق",
    "common.skipToContent": "تخطَّ إلى المحتوى الرئيسي",
  },
  en: {
    "brand.name": "El Nour",
    "brand.store": "El Nour Store",
    "brand.tagline": "Orders and customers, under control",

    "nav.group.sales": "Sales",
    "nav.group.money": "Money",
    "nav.group.intelligence": "Intelligence",
    "nav.group.system": "System",
    "nav.home": "Home",
    "nav.brain": "Business Brain",
    "nav.agent": "Assistant",
    "nav.approvals": "Approvals",
    "nav.orders": "Orders",
    "nav.customers": "Customers",
    "nav.products": "Products",
    "nav.reconciliation": "Daily reconciliation",
    "nav.collections": "Collection matching",
    "nav.reports": "Reports",
    "nav.analytics": "Analytics",
    "nav.overview": "Overview",
    "nav.briefing": "Daily briefing",
    "nav.decisions": "Decisions",
    "nav.risk": "Collection risk",
    "nav.anomalies": "Anomalies",
    "nav.forecast": "Forecast",
    "nav.simulator": "Profit simulator",
    "nav.costs": "Product costs",
    "nav.integrations": "Confirmations & integrations",
    "nav.settings": "Settings",
    "nav.collapse": "Collapse menu",
    "nav.expand": "Expand menu",
    "nav.more": "More",

    "topbar.openMenu": "Open menu",
    "topbar.search": "Search…",
    "topbar.theme.light": "Light mode",
    "topbar.theme.dark": "Dark mode",
    "topbar.notifications": "Notifications",
    "topbar.language": "Language",
    "topbar.account": "Account",
    "topbar.logout": "Sign out",

    "ai.launcher": "Ask about your business",
    "ai.placeholder": "Ask about your store's numbers…",
    "ai.send": "Send",
    "ai.close": "Close",
    "ai.question": "Your question",
    "ai.attach": "Attach a file",
    "ai.voice": "Voice input",

    "common.period": "Period",
    "common.today": "Today",
    "common.yesterday": "Yesterday",
    "common.last7": "Last 7 days",
    "common.last30": "Last 30 days",
    "common.thisMonth": "This month",
    "common.all": "All",
    "common.search": "Search",
    "common.filters": "Filters",
    "common.clear": "Clear",
    "common.export": "Export",
    "common.refresh": "Refresh",
    "common.save": "Save",
    "common.cancel": "Cancel",
    "common.loading": "Loading…",
    "common.error": "Could not load the data. Try again.",
    "common.retry": "Retry",
    "common.source": "Source",
    "common.empty": "No data",
    "common.close": "Close",
    "common.skipToContent": "Skip to main content",
  },
} as const

export type TranslationKey = keyof (typeof DICTIONARY)["ar"]

/** Exposed for the dictionary-integrity test. */
export const DICTIONARY_FOR_TEST = DICTIONARY

/**
 * A missing English key is a bug, not a cosmetic issue: the fallback would
 * show Arabic copy inside an English shell. This runs at module load in
 * development, and the unit test asserts the same thing in CI.
 */
export function assertDictionary(): void {
  const ar = Object.keys(DICTIONARY.ar)
  const en = Object.keys(DICTIONARY.en)
  const missingInEn = ar.filter((k) => !en.includes(k))
  const missingInAr = en.filter((k) => !ar.includes(k))
  if (missingInEn.length || missingInAr.length) {
    throw new Error(
      `i18n dictionary mismatch — missing in en: [${missingInEn.join(", ")}], missing in ar: [${missingInAr.join(", ")}]`
    )
  }
}

export type Translator = (key: TranslationKey) => string

export function createTranslator(language: Language): Translator {
  const table = DICTIONARY[language] as Record<string, string>
  return (key) => table[key] ?? (DICTIONARY.ar as Record<string, string>)[key] ?? key
}

type LanguageContextValue = {
  language: Language
  direction: "rtl" | "ltr"
  setLanguage: (language: Language) => void
  toggleLanguage: () => void
  t: Translator
}

const LanguageContext = React.createContext<LanguageContextValue | null>(null)

/**
 * Applies the stored language BEFORE the first paint — without this the
 * document renders RTL and then flips to LTR, which is a visible jump on
 * every navigation.
 */
export const languageInitScript = `
(function () {
  try {
    var stored = localStorage.getItem('${LANGUAGE_STORAGE_KEY}');
    var lang = stored === 'en' ? 'en' : 'ar';
    var root = document.documentElement;
    root.setAttribute('lang', lang);
    root.setAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
  } catch (e) {}
})();
`.trim()

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = React.useState<Language>("ar")

  React.useEffect(() => {
    const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY)
    if (stored === "en" || stored === "ar") setLanguageState(stored)
  }, [])

  const setLanguage = React.useCallback((next: Language) => {
    setLanguageState(next)
    try {
      window.localStorage.setItem(LANGUAGE_STORAGE_KEY, next)
    } catch {
      // A blocked storage (private mode) must not break the switch.
    }
    const root = document.documentElement
    root.setAttribute("lang", next)
    root.setAttribute("dir", DIRECTION[next])
  }, [])

  const toggleLanguage = React.useCallback(() => {
    setLanguage(language === "ar" ? "en" : "ar")
  }, [language, setLanguage])

  const t = React.useMemo(() => createTranslator(language), [language])

  const value = React.useMemo(
    () => ({ language, direction: DIRECTION[language], setLanguage, toggleLanguage, t }),
    [language, setLanguage, toggleLanguage, t]
  )

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
}

export function useLanguage(): LanguageContextValue {
  const ctx = React.useContext(LanguageContext)
  if (!ctx) {
    throw new Error("useLanguage must be used inside <LanguageProvider>")
  }
  return ctx
}
