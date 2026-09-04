import { describe, it, expect } from "vitest";
import { I18N } from "./settings-tab";
import { VIEW_I18N } from "./chat-view-i18n";
import { NOTICE_I18N } from "./notice-i18n";
import { SKILLS } from "./skills";
import type { Locale } from "./types";

/**
 * i18n 딕셔너리 정합성.
 *
 * 이전에는 신규 키 목록을 손으로 나열해 검사했기 때문에, 목록에 넣지 않은 키가 한 언어에만
 * 있어도 통과했다. 여기서는 en 블록의 **모든** 키를 기준으로 ko/ja를 전수 비교한다.
 */
const LOCALES: Locale[] = ["en", "ko", "ja"];

const DICTS = {
  I18N: I18N as Record<Locale, Record<string, unknown>>,
  VIEW_I18N: VIEW_I18N as Record<Locale, Record<string, unknown>>,
  NOTICE_I18N: NOTICE_I18N as Record<Locale, Record<string, unknown>>,
};

describe("i18n 딕셔너리 정합성", () => {
  for (const [dictName, dict] of Object.entries(DICTS)) {
    describe(dictName, () => {
      const enKeys = Object.keys(dict.en);

      it("en 블록이 비어있지 않다", () => {
        expect(enKeys.length).toBeGreaterThan(0);
      });

      for (const locale of LOCALES.filter((l) => l !== "en")) {
        it(`${locale}가 en과 같은 키 집합을 갖는다`, () => {
          const localeKeys = Object.keys(dict[locale]);
          expect([...localeKeys].sort()).toEqual([...enKeys].sort());
        });

        it(`${locale}의 모든 값이 en과 같은 종류(문자열 또는 함수)다`, () => {
          for (const key of enKeys) {
            expect(typeof dict[locale][key], `${dictName}.${locale}.${key}`).toBe(
              typeof dict.en[key]
            );
          }
        });
      }

      it("모든 언어의 문자열 값이 비어있지 않다", () => {
        for (const locale of LOCALES) {
          for (const key of enKeys) {
            const value = dict[locale][key];
            if (typeof value !== "string") continue;
            expect(value.trim().length, `${dictName}.${locale}.${key}`).toBeGreaterThan(0);
          }
        }
      });

      /**
       * 배열 값(예: 기능 목록)은 typeof가 모두 "object"라서 위 검사를 통과한다. 항목 수와
       * 각 항목의 키까지 비교해야 한 언어에만 항목이 빠지는 경우를 잡는다.
       */
      it("배열 값의 항목 수와 항목 구조가 언어별로 같다", () => {
        for (const key of enKeys) {
          const enValue = dict.en[key];
          if (!Array.isArray(enValue)) continue;
          for (const locale of LOCALES.filter((l) => l !== "en")) {
            const value = dict[locale][key];
            expect(Array.isArray(value), `${dictName}.${locale}.${key} is array`).toBe(true);
            const items = value as unknown[];
            expect(items.length, `${dictName}.${locale}.${key} length`).toBe(enValue.length);
            items.forEach((item, i) => {
              const enItem = enValue[i] as Record<string, unknown>;
              expect(
                Object.keys(item as Record<string, unknown>).sort(),
                `${dictName}.${locale}.${key}[${i}] keys`
              ).toEqual(Object.keys(enItem).sort());
              for (const field of Object.keys(enItem)) {
                const fieldValue = (item as Record<string, unknown>)[field];
                expect(
                  typeof fieldValue === "string" && fieldValue.trim().length > 0,
                  `${dictName}.${locale}.${key}[${i}].${field} non-empty`
                ).toBe(true);
              }
            });
          }
        }
      });
    });
  }

  /**
   * 스킬 목록은 딕셔너리가 아니라 항목별로 ko/en 짝을 갖는다. ko 이외의 언어는 영어 값을
   * 쓰므로(설정 탭), 한국어 이름·설명만 있는 항목이 남으면 ja 사용자에게 한국어가 보인다.
   */
  describe("SKILLS 영어 표기", () => {
    const HANGUL = /[가-힣]/;

    it("모든 스킬이 비어있지 않은 descriptionEn을 갖는다", () => {
      for (const skill of SKILLS) {
        expect(skill.descriptionEn?.trim().length, `${skill.id}.descriptionEn`).toBeGreaterThan(0);
      }
    });

    it("이름에 한글이 있으면 nameEn을 함께 갖는다", () => {
      for (const skill of SKILLS) {
        if (!HANGUL.test(skill.name)) continue;
        expect(skill.nameEn?.trim().length, `${skill.id}.nameEn`).toBeGreaterThan(0);
      }
    });

    it("영어 표기에 한글이 섞이지 않는다", () => {
      for (const skill of SKILLS) {
        expect(HANGUL.test(skill.descriptionEn), `${skill.id}.descriptionEn`).toBe(false);
        if (skill.nameEn) expect(HANGUL.test(skill.nameEn), `${skill.id}.nameEn`).toBe(false);
      }
    });
  });
});
