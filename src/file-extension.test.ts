import { describe, it, expect } from "vitest";
import {
  ALLOWED_TEXT_EXTENSIONS,
  isAllowedTextExtension,
} from "./file-extension-utils";

/**
 * 파일 확장자 필터링 테스트
 *
 * Property 1: Fault Condition - 텍스트 파일 확장자 허용
 *   .txt, .json, .yaml, .js, .ts 등 텍스트 파일이 허용되는지 확인
 *
 * Property 2: Preservation - .md 파일 첨부 동작 보존
 *   .md 파일이 기존처럼 정상 첨부되는지 확인
 *   바이너리 파일(.png, .jpg, .exe 등)이 여전히 거부되는지 확인
 *
 * Validates: Requirements 2.11, 3.12
 */

describe("파일 확장자 필터링", () => {
  // --- Property 1: Fault Condition ---
  // 텍스트 기반 파일 확장자가 허용되어야 함

  describe("Fault Condition - 텍스트 파일 확장자 허용 (Property 1)", () => {
    /**
     * **Validates: Requirements 2.11**
     */
    it.each(["txt", "json", "yaml", "yml", "csv", "xml", "html", "css", "js", "ts"])(
      '"%s" 확장자가 허용된다',
      (ext) => {
        expect(isAllowedTextExtension(ext)).toBe(true);
      }
    );

    it("ALLOWED_TEXT_EXTENSIONS에 주요 텍스트 확장자가 포함되어 있다", () => {
      const requiredExtensions = ["txt", "json", "yaml", "yml", "js", "ts"];
      for (const ext of requiredExtensions) {
        expect(ALLOWED_TEXT_EXTENSIONS).toContain(ext);
      }
    });
  });

  // --- Property 2: Preservation ---
  // .md 파일은 기존처럼 허용되고, 바이너리 파일은 거부되어야 함

  describe("Preservation - .md 파일 첨부 및 바이너리 거부 (Property 2)", () => {
    /**
     * **Validates: Requirements 3.12**
     */
    it('"md" 확장자가 허용된다', () => {
      expect(isAllowedTextExtension("md")).toBe(true);
    });

    it("ALLOWED_TEXT_EXTENSIONS에 md가 포함되어 있다", () => {
      expect(ALLOWED_TEXT_EXTENSIONS).toContain("md");
    });

    it.each(["png", "jpg", "jpeg", "gif", "exe", "bin", "zip", "pdf", "mp3", "mp4"])(
      '바이너리 확장자 "%s"가 거부된다',
      (ext) => {
        expect(isAllowedTextExtension(ext)).toBe(false);
      }
    );

    it("빈 문자열은 거부된다", () => {
      expect(isAllowedTextExtension("")).toBe(false);
    });
  });
});
