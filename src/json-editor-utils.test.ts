import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  validateJson,
  parseErrorPosition,
  formatJson,
  matchBrackets,
  getDefaultTemplate,
} from "./json-editor-utils";

// ============================================
// 단위 테스트: 엣지 케이스 및 구체적 예시
// ============================================

/**
 * validateJson 빈 문자열 처리
 * Validates: Requirements 1.5
 */
describe("validateJson - 빈 문자열 처리", () => {
  it("빈 문자열은 유효한 것으로 처리한다", () => {
    const result = validateJson("");
    expect(result).toEqual({ valid: true });
  });

  it("공백만 있는 문자열도 유효한 것으로 처리한다", () => {
    const result = validateJson("   ");
    expect(result).toEqual({ valid: true });
  });

  it("탭/개행만 있는 문자열도 유효한 것으로 처리한다", () => {
    const result = validateJson("\t\n  \n");
    expect(result).toEqual({ valid: true });
  });
});

/**
 * parseErrorPosition 브라우저별 에러 메시지 파싱
 * Validates: Requirements 1.6
 */
describe("parseErrorPosition - 브라우저별 에러 메시지 파싱", () => {
  it("V8/Node 최신 형식 'at line X column Y'를 파싱한다", () => {
    const result = parseErrorPosition(
      "Expected ',' or '}' after property value in JSON at line 3 column 5"
    );
    expect(result).toEqual({ line: 3, column: 5 });
  });

  it("Firefox 형식 'at line X column Y'를 파싱한다", () => {
    const result = parseErrorPosition(
      "JSON.parse: expected ',' or '}' after property value at line 2 column 10"
    );
    expect(result).toEqual({ line: 2, column: 10 });
  });

  it("괄호 형식 '(line X column Y)'를 파싱한다", () => {
    const result = parseErrorPosition(
      "Unexpected token (line 5 column 12)"
    );
    expect(result).toEqual({ line: 5, column: 12 });
  });

  it("'at position N' 형식은 줄/열 변환 불가로 null을 반환한다", () => {
    const result = parseErrorPosition(
      "Unexpected token o in JSON at position 1"
    );
    expect(result).toBeNull();
  });

  it("매칭되지 않는 에러 메시지는 null을 반환한다", () => {
    const result = parseErrorPosition("Unexpected end of JSON input");
    expect(result).toBeNull();
  });
});

/**
 * getDefaultTemplate 출력 검증
 * Validates: Requirements 4.2, 4.3
 */
describe("getDefaultTemplate - 기본 템플릿 검증", () => {
  it("출력이 유효한 JSON이다", () => {
    const template = getDefaultTemplate();
    expect(() => JSON.parse(template)).not.toThrow();
  });

  it("출력에 mcpServers 키가 포함되어 있다", () => {
    const template = getDefaultTemplate();
    const parsed = JSON.parse(template);
    expect(parsed).toHaveProperty("mcpServers");
  });

  it("서버 설정에 command 필드가 포함되어 있다", () => {
    const template = getDefaultTemplate();
    const parsed = JSON.parse(template);
    const servers = parsed.mcpServers;
    const serverNames = Object.keys(servers);

    // 최소 하나의 서버 설정이 존재해야 함
    expect(serverNames.length).toBeGreaterThan(0);

    // 모든 서버 설정에 command 필드가 있어야 함
    for (const name of serverNames) {
      expect(servers[name]).toHaveProperty("command");
    }
  });

  it("서버 설정에 args 필드가 포함되어 있다", () => {
    const template = getDefaultTemplate();
    const parsed = JSON.parse(template);
    const servers = parsed.mcpServers;
    const serverNames = Object.keys(servers);

    // 모든 서버 설정에 args 필드가 있어야 함
    for (const name of serverNames) {
      expect(servers[name]).toHaveProperty("args");
      expect(Array.isArray(servers[name].args)).toBe(true);
    }
  });
});

/**
 * matchBrackets 닫히지 않은 괄호 감지
 * Validates: Requirements 3.2
 */
describe("matchBrackets - 닫히지 않은 괄호 감지", () => {
  it("닫히지 않은 중괄호의 위치를 올바르게 보고한다", () => {
    const result = matchBrackets('{"key": "value"');
    expect(result.balanced).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    // 첫 번째 문자 '{'가 닫히지 않았으므로 위치는 line 1, column 1
    const unclosed = result.errors.find((e) => e.char === "{");
    expect(unclosed).toBeDefined();
    expect(unclosed!.line).toBe(1);
    expect(unclosed!.column).toBe(1);
  });

  it("닫히지 않은 대괄호의 위치를 올바르게 보고한다", () => {
    const result = matchBrackets('["a", "b"');
    expect(result.balanced).toBe(false);
    const unclosed = result.errors.find((e) => e.char === "[");
    expect(unclosed).toBeDefined();
    expect(unclosed!.line).toBe(1);
    expect(unclosed!.column).toBe(1);
  });

  it("여분의 닫는 괄호를 감지한다", () => {
    const result = matchBrackets('{"key": "value"}}');
    expect(result.balanced).toBe(false);
    const extra = result.errors.find((e) => e.char === "}");
    expect(extra).toBeDefined();
  });

  it("균형 잡힌 괄호는 오류 없이 통과한다", () => {
    const result = matchBrackets('{"a": [1, 2, {"b": 3}]}');
    expect(result.balanced).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("여러 줄에서 닫히지 않은 괄호의 줄/열 번호를 정확히 보고한다", () => {
    // 줄 1: {
    // 줄 2:   "key": [
    // 줄 3:     1, 2
    // 대괄호 '['는 줄 2에서 닫히지 않음
    const input = '{\n  "key": [\n    1, 2\n';
    const result = matchBrackets(input);
    expect(result.balanced).toBe(false);

    // 닫히지 않은 '[' 찾기
    const unclosedBracket = result.errors.find((e) => e.char === "[");
    expect(unclosedBracket).toBeDefined();
    expect(unclosedBracket!.line).toBe(2);

    // 닫히지 않은 '{' 찾기
    const unclosedBrace = result.errors.find((e) => e.char === "{");
    expect(unclosedBrace).toBeDefined();
    expect(unclosedBrace!.line).toBe(1);
  });
});
