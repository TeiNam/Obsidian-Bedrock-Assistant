import { describe, it, expect } from "vitest";
import {
  encodeMcpStdioMessage,
  formatMcpToolResult,
  joinSearchPath,
  McpManager,
  parseMcpConfig,
} from "./mcp-client";
import { DEFAULT_SETTINGS } from "./types";

describe("MCP 타임아웃 설정", () => {
  it("stdio 메시지는 Content-Length 없이 JSON 한 줄로 직렬화한다", () => {
    const payload = encodeMcpStdioMessage({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {},
    });

    expect(payload).toBe('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}\n');
    expect(payload).not.toContain("Content-Length");
  });

  it("DEFAULT_SETTINGS에 mcpTimeout 기본값이 10이다", () => {
    expect(DEFAULT_SETTINGS.mcpTimeout).toBe(10);
  });

  it("mcpTimeout이 BedrockAssistantSettings 인터페이스에 존재한다", () => {
    // DEFAULT_SETTINGS가 타입 체크를 통과하면 인터페이스에 필드가 존재함
    expect("mcpTimeout" in DEFAULT_SETTINGS).toBe(true);
    expect(typeof DEFAULT_SETTINGS.mcpTimeout).toBe("number");
  });

  it("McpManager.setTimeout()이 정상 호출된다", () => {
    const manager = new McpManager();
    // 에러 없이 호출되어야 함
    expect(() => manager.setTimeout(60)).not.toThrow();
  });

  it("McpManager.setTimeout()에 다양한 값을 설정할 수 있다", () => {
    const manager = new McpManager();
    // 최소값 (10초)
    expect(() => manager.setTimeout(10)).not.toThrow();
    // 최대값 (120초)
    expect(() => manager.setTimeout(120)).not.toThrow();
    // 중간값
    expect(() => manager.setTimeout(45)).not.toThrow();
  });

  it("서버가 없는 상태에서 setTimeout 호출 시 에러가 발생하지 않는다", () => {
    const manager = new McpManager();
    // 연결된 서버가 없어도 안전하게 동작해야 함
    expect(() => manager.setTimeout(90)).not.toThrow();
    expect(manager.getStatus()).toEqual([]);
  });

  it("MCP 설정 구조와 필드 타입을 검증한다", () => {
    expect(parseMcpConfig('{"mcpServers":{"local":{"command":"npx","args":["-y"]}}}'))
      .toEqual({ mcpServers: { local: { command: "npx", args: ["-y"] } } });
    expect(() => parseMcpConfig("{}")).toThrow("mcpServers");
    expect(() => parseMcpConfig('{"mcpServers":{"bad":{"command":1}}}')).toThrow("command");
    expect(() => parseMcpConfig('{"mcpServers":{"bad":{"command":"x","args":[1]}}}')).toThrow("args");
  });

  it("텍스트 외 MCP 콘텐츠도 버리지 않는다", () => {
    const formatted = formatMcpToolResult({
      content: [
        { type: "text", text: "설명" },
        { type: "image", mimeType: "image/png", data: "AAAA" },
        { type: "resource", resource: { uri: "file:///a.txt", text: "자료" } },
      ],
      structuredContent: { count: 2 },
    });

    expect(formatted).toContain("설명");
    expect(formatted).toContain('"type":"image"');
    expect(formatted).toContain('"type":"resource"');
    expect(formatted).toContain('"count":2');
  });

  it("Windows PATH는 세미콜론과 드라이브 문자를 보존한다", () => {
    expect(joinSearchPath(["C:\\Windows", "C:\\Program Files\\nodejs"], ";"))
      .toBe("C:\\Windows;C:\\Program Files\\nodejs");
  });
});
