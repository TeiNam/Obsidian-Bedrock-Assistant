import { describe, it, expect } from "vitest";
import { McpManager } from "./mcp-client";
import { DEFAULT_SETTINGS } from "./types";

describe("MCP 타임아웃 설정", () => {
  it("DEFAULT_SETTINGS에 mcpTimeout 기본값이 30이다", () => {
    expect(DEFAULT_SETTINGS.mcpTimeout).toBe(30);
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
});
