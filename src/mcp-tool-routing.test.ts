import { describe, it, expect, vi } from "vitest";
import { McpManager } from "./mcp-client";

/**
 * B3: MCP 도구 이름 파싱 — toolServerMap 기반 라우팅 테스트
 *
 * 기존 정규식 `/^mcp_([^_]+)_(.+)$/`는 서버 이름에 `_`가 포함되면
 * 첫 번째 `_`에서 분리되어 잘못된 서버로 라우팅되는 버그가 있었음.
 * toolServerMap 기반 라우팅으로 수정하여 서버 이름에 `_`가 포함되어도 정확히 동작.
 */
describe("B3: MCP 도구 이름 라우팅 (toolServerMap 기반)", () => {
  // 테스트용 가짜 서버 객체 생성 헬퍼
  function createMockServer(name: string, toolNames: string[], connected = true) {
    return {
      name,
      connected,
      tools: toolNames.map((t) => ({
        name: `mcp_${name}_${t}`,
        description: `[MCP:${name}] ${t}`,
        input_schema: { type: "object", properties: {} },
        _mcpServer: name,
        _mcpToolName: t,
      })),
      callTool: vi.fn().mockResolvedValue("ok"),
      setTimeoutSeconds: vi.fn(),
      refreshTools: vi.fn(),
      disconnect: vi.fn(),
    };
  }

  // McpManager 내부 상태를 직접 설정하는 헬퍼
  function setupManager(
    servers: Array<{ name: string; toolNames: string[]; connected?: boolean }>
  ): McpManager {
    const manager = new McpManager();
    const serversMap = (manager as any).servers as Map<string, any>;
    const toolServerMap = (manager as any).toolServerMap as Map<string, string>;

    for (const { name, toolNames, connected } of servers) {
      const mock = createMockServer(name, toolNames, connected ?? true);
      serversMap.set(name, mock);
      if (mock.connected) {
        for (const tool of mock.tools) {
          toolServerMap.set(tool.name, name);
        }
      }
    }

    return manager;
  }

  it("서버 이름에 _가 없는 기본 케이스가 정상 동작한다", async () => {
    const manager = setupManager([
      { name: "github", toolNames: ["search_code", "create_issue"] },
    ]);

    const result = await manager.executeTool("mcp_github_search_code", {});
    expect(result).toBe("ok");
  });

  it("서버 이름에 _가 포함된 경우 정확히 라우팅된다", async () => {
    const manager = setupManager([
      { name: "my_server", toolNames: ["get_data", "list_items"] },
    ]);

    const result = await manager.executeTool("mcp_my_server_get_data", {});
    expect(result).toBe("ok");

    // 올바른 도구 이름으로 callTool이 호출되었는지 확인
    const server = (manager as any).servers.get("my_server");
    expect(server.callTool).toHaveBeenCalledWith("get_data", {});
  });

  it("서버 이름에 _가 여러 개 포함된 경우에도 정확히 라우팅된다", async () => {
    const manager = setupManager([
      { name: "my_custom_server", toolNames: ["run_query"] },
    ]);

    const result = await manager.executeTool("mcp_my_custom_server_run_query", {});
    expect(result).toBe("ok");

    const server = (manager as any).servers.get("my_custom_server");
    expect(server.callTool).toHaveBeenCalledWith("run_query", {});
  });

  it("도구 이름에도 _가 포함된 복합 케이스가 정확히 동작한다", async () => {
    const manager = setupManager([
      { name: "my_server", toolNames: ["get_user_data"] },
    ]);

    const result = await manager.executeTool("mcp_my_server_get_user_data", {});
    expect(result).toBe("ok");

    const server = (manager as any).servers.get("my_server");
    expect(server.callTool).toHaveBeenCalledWith("get_user_data", {});
  });

  it("여러 서버가 있을 때 올바른 서버로 라우팅된다", async () => {
    const manager = setupManager([
      { name: "github", toolNames: ["search_code"] },
      { name: "my_db_server", toolNames: ["run_query"] },
    ]);

    await manager.executeTool("mcp_my_db_server_run_query", { sql: "SELECT 1" });

    const dbServer = (manager as any).servers.get("my_db_server");
    expect(dbServer.callTool).toHaveBeenCalledWith("run_query", { sql: "SELECT 1" });

    // github 서버는 호출되지 않아야 함
    const githubServer = (manager as any).servers.get("github");
    expect(githubServer.callTool).not.toHaveBeenCalled();
  });

  it("등록되지 않은 도구 이름은 에러 메시지를 반환한다", async () => {
    const manager = setupManager([
      { name: "github", toolNames: ["search_code"] },
    ]);

    const result = await manager.executeTool("mcp_unknown_server_tool", {});
    expect(result).toContain("잘못된 MCP 도구 이름");
  });

  it("연결 해제된 서버의 도구는 toolServerMap에 포함되지 않는다", async () => {
    const manager = setupManager([
      { name: "my_server", toolNames: ["get_data"], connected: false },
    ]);

    const result = await manager.executeTool("mcp_my_server_get_data", {});
    expect(result).toContain("잘못된 MCP 도구 이름");
  });

  it("disconnectAll() 호출 시 toolServerMap이 초기화된다", () => {
    const manager = setupManager([
      { name: "my_server", toolNames: ["get_data"] },
    ]);

    const toolServerMap = (manager as any).toolServerMap as Map<string, string>;
    expect(toolServerMap.size).toBeGreaterThan(0);

    manager.disconnectAll();
    expect(toolServerMap.size).toBe(0);
  });

  it("getAllTools()가 모든 서버의 도구를 반환한다", () => {
    const manager = setupManager([
      { name: "github", toolNames: ["search_code"] },
      { name: "my_db_server", toolNames: ["run_query", "list_tables"] },
    ]);

    const tools = manager.getAllTools();
    expect(tools).toHaveLength(3);
    expect(tools.map((t) => t.name)).toContain("mcp_github_search_code");
    expect(tools.map((t) => t.name)).toContain("mcp_my_db_server_run_query");
    expect(tools.map((t) => t.name)).toContain("mcp_my_db_server_list_tables");
  });
});
