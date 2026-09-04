import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const childProcessMocks = vi.hoisted(() => ({
  spawn: vi.fn(),
}));

vi.mock("child_process", () => ({
  spawn: childProcessMocks.spawn,
}));

import { McpManager } from "./mcp-client";

class FakeProcess extends EventEmitter {
  pid = 123;
  killed = false;
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  stdin: {
    writable: boolean;
    write: ReturnType<typeof vi.fn>;
    end: ReturnType<typeof vi.fn>;
  };
  kill = vi.fn(() => {
    this.killed = true;
    return true;
  });

  constructor(respond: boolean) {
    super();
    this.stdin = {
      writable: true,
      end: vi.fn(),
      write: vi.fn((raw: string) => {
        if (!respond) return true;
        const request = JSON.parse(String(raw)) as { id?: number; method?: string };
        if (request.id === undefined) return true;
        const result = request.method === "tools/list" ? { tools: [] } : {};
        queueMicrotask(() => {
          this.stdout.emit(
            "data",
            Buffer.from(`${JSON.stringify({ jsonrpc: "2.0", id: request.id, result })}\n`)
          );
        });
        return true;
      }),
    };
  }
}

const CONFIG = JSON.stringify({
  mcpServers: {
    local: { command: "fake-command" },
  },
});

describe("MCP 연결 수명주기", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    childProcessMocks.spawn.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("사용자 타임아웃을 initialize 요청부터 적용한다", async () => {
    childProcessMocks.spawn.mockReturnValue(new FakeProcess(false));
    const manager = new McpManager();
    manager.setTimeout(1);

    const loading = manager.loadConfig(CONFIG);
    let settled = false;
    void loading.then(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(loading).resolves.toEqual({ connected: [], failed: ["local"] });
  });

  it("중지 전에 예약된 재연결을 취소한다", async () => {
    const process = new FakeProcess(true);
    childProcessMocks.spawn.mockReturnValue(process);
    const manager = new McpManager();
    manager.setTimeout(1);
    await manager.loadConfig(CONFIG);

    process.emit("exit", 1);
    manager.disconnectAll();
    await vi.advanceTimersByTimeAsync(5000);

    expect(childProcessMocks.spawn).toHaveBeenCalledTimes(1);
  });

  it("응답을 받은 요청의 타임아웃 타이머를 즉시 정리한다", async () => {
    childProcessMocks.spawn.mockReturnValue(new FakeProcess(true));
    const manager = new McpManager();
    manager.setTimeout(60);

    await manager.loadConfig(CONFIG);

    expect(vi.getTimerCount()).toBe(0);
  });
});
