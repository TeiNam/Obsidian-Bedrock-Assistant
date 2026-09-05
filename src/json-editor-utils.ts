/** JSON 검증 결과 */
export interface JsonValidationResult {
  valid: boolean;
  error?: {
    message: string;
    line: number;
    column: number;
  };
}

/** 괄호 매칭 결과 */
export interface BracketMatchResult {
  balanced: boolean;
  errors: BracketError[];
}

/** 괄호 오류 정보 */
export interface BracketError {
  char: string;       // 짝이 맞지 않는 괄호 문자
  position: number;   // 텍스트 내 인덱스 (0-based)
  line: number;       // 1-based 줄 번호
  column: number;     // 1-based 열 번호
}

/**
 * JSON 문자열을 검증하고 오류 위치를 반환한다.
 * 빈 문자열은 유효한 것으로 처리한다.
 */
export function validateJson(text: string): JsonValidationResult {
  // 빈 문자열 또는 공백만 있는 경우 유효한 것으로 처리
  if (text.trim() === "") {
    return { valid: true };
  }

  try {
    // JSON 파싱 시도
    JSON.parse(text);
    return { valid: true };
  } catch (e) {
    // 에러 메시지 추출
    const message = e instanceof Error ? e.message : String(e);

    // parseErrorPosition으로 줄/열 번호 추출 시도
    const position = parseErrorPosition(message);

    // 위치 정보가 없으면 기본값(1, 1) 사용
    const line = position?.line ?? 1;
    const column = position?.column ?? 1;

    return {
      valid: false,
      error: { message, line, column },
    };
  }
}

/**
 * JSON.parse 에러 메시지에서 줄/열 번호를 추출한다.
 * 브라우저별 에러 메시지 형식 차이를 처리한다.
 *
 * 지원하는 에러 메시지 형식:
 * - V8/Node 최신: "... at line X column Y" 또는 "... (line X column Y)"
 * - Firefox: "JSON.parse: ... at line X column Y"
 * - Safari/기타: "line X column Y" 패턴
 * - "at position N" 형식은 원본 텍스트 없이 줄/열 변환 불가 → null 반환
 */
export function parseErrorPosition(errorMessage: string): { line: number; column: number } | null {
  // 패턴 1: "at line X column Y" 또는 "(line X column Y)" 형식
  // V8 최신, Firefox 등에서 사용
  const lineColMatch = errorMessage.match(/line\s+(\d+)\s+column\s+(\d+)/i);
  if (lineColMatch) {
    return {
      line: parseInt(lineColMatch[1], 10),
      column: parseInt(lineColMatch[2], 10),
    };
  }

  // 패턴 2: "at position N" 형식 (V8 구버전)
  // 원본 텍스트 없이는 줄/열 변환 불가 → null 반환
  // 호출자(validateJson)가 기본값 { line: 1, column: 1 }을 사용함

  // 어떤 패턴에도 매칭되지 않으면 null 반환
  return null;
}

/**
 * 유효한 JSON 문자열을 2칸 들여쓰기로 포맷팅한다.
 * 유효하지 않은 JSON은 원본을 그대로 반환한다.
 */
export function formatJson(text: string): string {
  try {
    // JSON 파싱 후 2칸 들여쓰기로 재직렬화
    const parsed: unknown = JSON.parse(text);
    return JSON.stringify(parsed, null, 2);
  } catch {
    // 유효하지 않은 JSON은 원본 그대로 반환
    return text;
  }
}

/**
 * 괄호/중괄호의 열림-닫힘 쌍을 분석한다.
 * JSON 문자열 리터럴 내부의 괄호는 무시한다.
 *
 * 알고리즘:
 * 1. 각 문자를 순회하며 줄/열 번호를 추적 (1-based)
 * 2. 문자열 리터럴 내부에서는 괄호를 무시 (이스케이프된 따옴표 처리)
 * 3. 여는 괄호(`{`, `[`)를 만나면 스택에 push
 * 4. 닫는 괄호(`}`, `]`)를 만나면 스택 top과 쌍 비교
 * 5. 순회 후 스택에 남은 항목은 짝이 없는 여는 괄호
 */
export function matchBrackets(text: string): BracketMatchResult {
  const errors: BracketError[] = [];
  // 스택: 여는 괄호의 문자, 위치, 줄/열 정보를 저장
  const stack: { char: string; position: number; line: number; column: number }[] = [];

  // 닫는 괄호 → 여는 괄호 매핑
  const matchingOpen: Record<string, string> = { "}": "{", "]": "[" };

  let line = 1;    // 현재 줄 번호 (1-based)
  let column = 1;  // 현재 열 번호 (1-based)
  let inString = false; // 문자열 리터럴 내부 여부

  let i = 0;
  while (i < text.length) {
    const ch = text[i];

    if (inString) {
      // 문자열 리터럴 내부: 이스케이프 시퀀스 처리
      if (ch === "\\") {
        // 백슬래시 다음 문자를 건너뜀 (이스케이프된 문자)
        // 백슬래시 자체의 열 업데이트
        column++;
        i++;
        // 이스케이프된 문자의 줄/열 업데이트
        if (i < text.length) {
          if (text[i] === "\n") {
            line++;
            column = 1;
          } else {
            column++;
          }
          i++;
        }
        continue;
      }
      if (ch === '"') {
        // 문자열 리터럴 종료
        inString = false;
      }
    } else {
      // 문자열 리터럴 외부
      if (ch === '"') {
        // 문자열 리터럴 시작
        inString = true;
      } else if (ch === "{" || ch === "[") {
        // 여는 괄호: 스택에 push
        stack.push({ char: ch, position: i, line, column });
      } else if (ch === "}" || ch === "]") {
        // 닫는 괄호: 스택 top과 쌍 비교
        const expectedOpen = matchingOpen[ch];
        if (stack.length > 0 && stack[stack.length - 1].char === expectedOpen) {
          // 쌍이 맞음 → 스택에서 pop
          stack.pop();
        } else {
          // 쌍이 맞지 않음 → 오류 기록
          errors.push({ char: ch, position: i, line, column });
        }
      }
    }

    // 줄/열 번호 업데이트
    if (ch === "\n") {
      line++;
      column = 1;
    } else {
      column++;
    }
    i++;
  }

  // 스택에 남은 항목은 짝이 없는 여는 괄호
  for (const item of stack) {
    errors.push({
      char: item.char,
      position: item.position,
      line: item.line,
      column: item.column,
    });
  }

  return {
    balanced: errors.length === 0,
    errors,
  };
}

/**
 * McpServerConfig 스키마에 맞는 기본 JSON 템플릿을 반환한다.
 * command, args 필드를 포함하는 예시 서버 설정을 제공한다.
 * 반환값은 2칸 들여쓰기로 포맷팅된 유효한 JSON 문자열이다.
 */
export function getDefaultTemplate(): string {
  // mcpServers 스키마에 맞는 기본 템플릿 객체
  const template = {
    mcpServers: {
      "server-name": {
        command: "npx",
        args: ["-y", "@example/mcp-server"],
      },
    },
  };

  // 2칸 들여쓰기로 포맷팅된 JSON 문자열 반환
  return JSON.stringify(template, null, 2);
}
