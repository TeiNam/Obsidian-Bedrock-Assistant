import { ChildProcess, spawn } from "child_process";
import type { ToolDefinition } from "./types";

// MCP 서버 설정 타입
export interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  disabled?: boolean;
}

export interface McpConfig {
  mcpServers: Record<string, McpServerConfig>;
}

// MCP JSON-RPC 메시지 타입
interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

// MCP 도구 정의 (서버에서 반환)
interface McpToolDef {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

// 단일 MCP 서버 연결
class McpServerConnection {
  readonly name: string;
  private config: McpServerConfig;
  private process: ChildProcess | null = null;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private buffer = "";
  private _tools: ToolDefinition[] = [];
  private _connected = false;

  constructor(name: string, config: McpServerConfig) {
    this.name = name;
    this.config = config;
  }

  get tools(): ToolDefinition[] {
    return this._tools;
  }

  get connected(): boolean {
    return this._connected;
  }

  // 서버 프로세스 시작 및 초기화
  async connect(): Promise<void> {
    if (this.config.disabled) return;

    const env = { ...process.env, ...(this.config.env || {}) };

    this.process = spawn(this.config.command, this.config.args || [], {
      stdio: ["pipe", "pipe", "pipe"],
      env,
      shell: process.platform === "win32",
    });

    // stdout에서 JSON-RPC 응답 수신
    this.process.stdout?.on("data", (data: Buffer) => {
      this.buffer += data.toString();
      this.processBuffer();
    });

    this.process.stderr?.on("data", (data: Buffer) => {
      console.warn(`[MCP:${this.name}] stderr:`, data.toString().trim());
    });

    this.process.on("error", (err) => {
      console.error(`[MCP:${this.name}] 프로세스 오류:`, err);
      this._connected = false;
    });

    this.process.on("exit", (code) => {
      console.log(`[MCP:${this.name}] 프로세스 종료 (code: ${code})`);
      this._connected = false;
      // 대기 중인 요청 모두 reject
      for (const [, p] of this.pending) {
        p.reject(new Error(`MCP 서버 종료 (code: ${code})`));
      }
      this.pending.clear();
    });

    // MCP 초기화 핸드셰이크
    try {
      await this.sendRequest("initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "assistant-kiro", version: "0.1.0" },
      });

      // initialized 알림 전송
      this.sendNotification("notifications/initialized", {});
      this._connected = true;

      // 도구 목록 가져오기
      await this.refreshTools();
    } catch (error) {
      console.error(`[MCP:${this.name}] 초기화 실패:`, error);
      this.disconnect();
      throw error;
    }
  }

  // 도구 목록 갱신
  async refreshTools(): Promise<void> {
    try {
      const result = (await this.sendRequest("tools/list", {})) as { tools: McpToolDef[] };
      this._tools = (result.tools || []).map((t) => ({
        // MCP 도구 이름에 서버명 접두사 추가 (충돌 방지)
        name: `mcp_${this.name}_${t.name}`,
        description: `[MCP:${this.name}] ${t.description || t.name}`,
        input_schema: t.inputSchema || { type: "object", properties: {} },
        // 원본 이름 보관
        _mcpServer: this.name,
        _mcpToolName: t.name,
      }));
    } catch (error) {
      console.error(`[MCP:${this.name}] 도구 목록 가져오기 실패:`, error);
      this._tools = [];
    }
  }

  // 도구 실행
  async callTool(originalName: string, args: Record<string, unknown>): Promise<string> {
    const result = (await this.sendRequest("tools/call", {
      name: originalName,
      arguments: args,
    })) as { content: Array<{ type: string; text?: string }> };

    // 결과 텍스트 추출
    if (result.content && Array.isArray(result.content)) {
      return result.content
        .filter((c) => c.type === "text" && c.text)
        .map((c) => c.text)
        .join("\n");
    }
    return JSON.stringify(result);
  }

  // JSON-RPC 요청 전송
  private sendRequest(method: string, params: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.process?.stdin?.writable) {
        reject(new Error("MCP 서버에 연결되지 않음"));
        return;
      }

      const id = this.nextId++;
      const request: JsonRpcRequest = {
        jsonrpc: "2.0",
        id,
        method,
        params,
      };

      this.pending.set(id, { resolve, reject });

      const msg = JSON.stringify(request);
      this.process.stdin.write(`Content-Length: ${Buffer.byteLength(msg)}\r\n\r\n${msg}`);

      // 타임아웃 30초
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`MCP 요청 타임아웃: ${method}`));
        }
      }, 30000);
    });
  }

  // JSON-RPC 알림 전송 (응답 없음)
  private sendNotification(method: string, params: Record<string, unknown>): void {
    if (!this.process?.stdin?.writable) return;

    const msg = JSON.stringify({
      jsonrpc: "2.0",
      method,
      params,
    });
    this.process.stdin.write(`Content-Length: ${Buffer.byteLength(msg)}\r\n\r\n${msg}`);
  }

  // 수신 버퍼에서 완전한 메시지 파싱
  private processBuffer(): void {
    while (true) {
      // Content-Length 헤더 찾기
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) break;

      const header = this.buffer.slice(0, headerEnd);
      const match = header.match(/Content-Length:\s*(\d+)/i);
      if (!match) {
        // 헤더 파싱 실패 시 해당 부분 스킵
        this.buffer = this.buffer.slice(headerEnd + 4);
        continue;
      }

      const contentLength = parseInt(match[1], 10);
      const bodyStart = headerEnd + 4;

      if (this.buffer.length < bodyStart + contentLength) {
        // 아직 전체 메시지가 도착하지 않음
        break;
      }

      const body = this.buffer.slice(bodyStart, bodyStart + contentLength);
      this.buffer = this.buffer.slice(bodyStart + contentLength);

      try {
        const msg = JSON.parse(body) as JsonRpcResponse;
        if (msg.id !== undefined && this.pending.has(msg.id)) {
          const p = this.pending.get(msg.id)!;
          this.pending.delete(msg.id);
          if (msg.error) {
            p.reject(new Error(`MCP 오류: ${msg.error.message}`));
          } else {
            p.resolve(msg.result);
          }
        }
        // 알림(notification)은 id가 없으므로 무시
      } catch {
        // JSON 파싱 실패 무시
      }
    }
  }

  // 서버 연결 종료
  disconnect(): void {
    this._connected = false;
    this._tools = [];
    if (this.process) {
      try {
        this.process.kill();
      } catch {
        // 이미 종료된 경우 무시
      }
      this.process = null;
    }
    for (const [, p] of this.pending) {
      p.reject(new Error("MCP 서버 연결 종료"));
    }
    this.pending.clear();
  }
}

// MCP 서버 매니저 — 여러 서버를 관리
export class McpManager {
  private servers = new Map<string, McpServerConnection>();
  private config: McpConfig = { mcpServers: {} };

  // 설정 로드 및 서버 연결
  async loadConfig(configJson: string): Promise<{ connected: string[]; failed: string[] }> {
    // 기존 서버 모두 종료
    this.disconnectAll();

    try {
      this.config = JSON.parse(configJson) as McpConfig;
    } catch {
      this.config = { mcpServers: {} };
      return { connected: [], failed: [] };
    }

    const connected: string[] = [];
    const failed: string[] = [];

    for (const [name, serverConfig] of Object.entries(this.config.mcpServers)) {
      if (serverConfig.disabled) continue;

      const conn = new McpServerConnection(name, serverConfig);
      try {
        await conn.connect();
        this.servers.set(name, conn);
        connected.push(name);
      } catch (error) {
        console.error(`[MCP] ${name} 연결 실패:`, error);
        failed.push(name);
      }
    }

    return { connected, failed };
  }

  // 모든 MCP 도구 목록 (옵시디언 도구와 합칠 용도)
  getAllTools(): ToolDefinition[] {
    const tools: ToolDefinition[] = [];
    for (const server of this.servers.values()) {
      if (server.connected) {
        tools.push(...server.tools);
      }
    }
    return tools;
  }

  // MCP 도구 실행 (접두사 기반으로 서버 라우팅)
  async executeTool(prefixedName: string, input: Record<string, unknown>): Promise<string> {
    // 이름 형식: mcp_{serverName}_{toolName}
    const match = prefixedName.match(/^mcp_([^_]+)_(.+)$/);
    if (!match) {
      return `잘못된 MCP 도구 이름: ${prefixedName}`;
    }

    const [, serverName, toolName] = match;
    const server = this.servers.get(serverName);
    if (!server || !server.connected) {
      return `MCP 서버에 연결되지 않음: ${serverName}`;
    }

    try {
      return await server.callTool(toolName, input);
    } catch (error) {
      return `MCP 도구 실행 오류 (${toolName}): ${(error as Error).message}`;
    }
  }

  // MCP 도구인지 확인
  isMcpTool(name: string): boolean {
    return name.startsWith("mcp_");
  }

  // 연결된 서버 상태 정보
  getStatus(): Array<{ name: string; connected: boolean; toolCount: number }> {
    const status: Array<{ name: string; connected: boolean; toolCount: number }> = [];
    for (const [name, server] of this.servers) {
      status.push({
        name,
        connected: server.connected,
        toolCount: server.tools.length,
      });
    }
    return status;
  }

  // 모든 서버 종료
  disconnectAll(): void {
    for (const server of this.servers.values()) {
      server.disconnect();
    }
    this.servers.clear();
  }
}
