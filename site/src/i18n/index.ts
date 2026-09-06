// 랜딩 페이지 문자열. 문서 본문은 Starlight 이 별도로 다룬다(src/content/i18n/).
//
// ‼️ 없는 키는 **던진다**. 옛 랜딩은 `data-i18n` 치환이라 키가 없으면 영문 원문이
//    그대로 남아 아무도 알아채지 못했다. 빌드 시 터지면 반드시 고쳐진다.
import en from "./en.json";
import ko from "./ko.json";

export const LOCALES = ["en", "ko"] as const;
export type Locale = (typeof LOCALES)[number];

/** 키 집합은 en 이 정의한다 — ko 에만 있는 키는 패리티 테스트가 잡는다. */
export type MessageKey = keyof typeof en;

const DICTS: Record<Locale, Record<string, string>> = { en, ko };

export const isLocale = (value: string): value is Locale =>
  (LOCALES as readonly string[]).includes(value);

/** 그 로케일의 다른 짝 — 언어 전환 링크에 쓴다. */
export const otherLocale = (locale: Locale): Locale => (locale === "en" ? "ko" : "en");

export const LOCALE_LABELS: Record<Locale, string> = { en: "English", ko: "한국어" };

export function useTranslations(locale: Locale) {
  const dict = DICTS[locale];
  return (key: MessageKey): string => {
    const value = dict[key];
    if (value === undefined) {
      throw new Error(`i18n 키 "${String(key)}" 가 ${locale}.json 에 없습니다`);
    }
    return value;
  };
}
