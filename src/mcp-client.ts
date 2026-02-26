import { ChildProcess, spawn } from "child_process";
import { existsSync } from "fs";
import { join } from "path";
import type { ToolDefinition } from "./types";
import { BRANDING } from "./branding";

// PATH에서 실행 파일의 절대 경로를 찾는 유틸리티 (GUI 앱에서 which 대체)
function resolveCommand(command: string, pathEnv: string): string {
  if (command.startsWith("/")) return command;
  for (const dir of pathEnv.split(":")) {
    if (!dir) continue;
    const full = join(dir, command);
    if (existsSync(full)) return full;
  }
  return command;
}

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
  // MCP 요청 타임아웃 (밀리초)
  private _timeoutMs = 30000;

  constructor(name: string, config: McpServerConfig) {
    this.name = name;
    this.config = config;
  }

  // 타임아웃 설정 (초 단위 입력 → 밀리초로 변환)
  setTimeoutSeconds(seconds: number): void {
    this._timeoutMs = seconds * 1000;
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

    // GUI 앱(옵시디언)은 쉘의 PATH를 상속받지 못하므로 일반적인 경로를 보강
    const extraPaths = [
      "/usr/local/bin",
      "/opt/homebrew/bin",
      `${process.env.HOME}/.local/bin`,
      `${process.env.HOME}/.cargo/bin`,
    ].join(":");
    const currentPath = process.env.PATH || "/usr/bin:/bin";
    const augmentedPath = `${extraPaths}:${currentPath}`;
    const env = {
      ...process.env,
      PATH: augmentedPath,
      ...(this.config.env || {}),
    };

    // command를 절대 경로로 resolve
    const resolvedCommand = resolveCommand(this.config.command, augmentedPath);

    this.process = spawn(resolvedCommand, this.config.args || [], {
      stdio: ["pipe", "pipe", "pipe"],
      env,
      shell: false,
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
      this._connected = false;
      for (const [, p] of this.pending) {
        p.reject(new Error(`MCP 서버 종료 (code: ${code})`));
      }
      this.pending.clear();
    });

    // 프로세스가 준비될 때까지 대기 (도커 컨테이너 등 시작 시간 필요)
    await new Promise<void>((resolve) => {
      if (this.process?.pid) {
        resolve();
      } else {
        this.process?.once("spawn", () => resolve());
        this.process?.once("error", () => resolve());
      }
    });

    // MCP 초기화 핸드셰이크
    try {
      await this.sendRequest("initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: BRANDING.pluginId, version: "0.1.0" },
      });

      this.sendNotification("notifications/initialized", {});
      this._connected = true;

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
        name: `mcp_${this.name}_${t.name}`,
        description: `[MCP:${this.name}] ${t.description || t.name}`,
        input_schema: t.inputSchema || { type: "object", properties: {} },
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
      const request: JsonRpcRequest = { jsonrpc: "2.0", id, method, params };
      this.pending.set(id, { resolve, reject });

      const msg = JSON.stringify(request);
      const payload = `Content-Length: ${Buffer.byteLength(msg)}\r\n\r\n${msg}\n`;
      this.process.stdin.write(payload);

      // 설정된 타임아웃 적용
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`MCP 요청 타임아웃: ${method}`));
        }
      }, this._timeoutMs);
    });
  }

  // JSON-RPC 알림 전송 (응답 없음)
  private sendNotification(method: string, params: Record<string, unknown>): void {
    if (!this.process?.stdin?.writable) return;
    const msg = JSON.stringify({ jsonrpc: "2.0", method, params });
    this.process.stdin.write(`Content-Length: ${Buffer.byteLength(msg)}\r\n\r\n${msg}\n`);
  }

  // 수신 버퍼에서 완전한 메시지 파싱 (Content-Length 헤더 + raw JSON 모두 지원)
  private processBuffer(): void {
    while (this.buffer.length > 0) {
      // 1) Content-Length 헤더가 있는 경우
      const headerMatch = this.buffer.match(/^Content-Length:\s*(\d+)\r\n\r\n/i);
      if (headerMatch) {
        const contentLength = parseInt(headerMatch[1], 10);
        const bodyStart = headerMatch[0].length;
        if (this.buffer.length < bodyStart + contentLength) break;

        const body = this.buffer.slice(bodyStart, bodyStart + contentLength);
        this.buffer = this.buffer.slice(bodyStart + contentLength);
        this.handleJsonMessage(body);
        continue;
      }

      // 2) raw JSON (줄바꿈 구분)
      const newlineIdx = this.buffer.indexOf("\n");
      if (newlineIdx === -1) {
        const trimmed = this.buffer.trim();
        if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
          try {
            JSON.parse(trimmed);
            this.buffer = "";
            this.handleJsonMessage(trimmed);
            continue;
          } catch {
            break;
          }
        }
        break;
      }

      const line = this.buffer.slice(0, newlineIdx).trim();
      this.buffer = this.buffer.slice(newlineIdx + 1);
      if (line.length === 0) continue;
      if (line.startsWith("{")) {
        this.handleJsonMessage(line);
      }
    }
  }

  // JSON-RPC 메시지 처리
  private handleJsonMessage(raw: string): void {
    try {
      const msg = JSON.parse(raw) as JsonRpcResponse;
      if (msg.id !== undefined && this.pending.has(msg.id)) {
        const p = this.pending.get(msg.id)!;
        this.pending.delete(msg.id);
        if (msg.error) {
          p.reject(new Error(`MCP 오류: ${msg.error.message}`));
        } else {
          p.resolve(msg.result);
        }
      }
    } catch {
      // JSON 파싱 실패 무시
    }
  }

  // 서버 연결 종료
  // 서버 연결 종료
    disconnect(): void {
      this._connected = false;
      this._tools = [];
      if (this.process) {
        try {
          // stdin을 먼저 닫아서 도커 컨테이너(-i 모드)도 정상 종료되도록 함
          this.process.stdin?.end();
          this.process.kill();
        } catch { /* 이미 종료된 경우 */ }
        // SIGTERM으로 안 죽으면 강제 종료
        const proc = this.process;
        setTimeout(() => {
          try { if (!proc.killed) proc.kill("SIGKILL"); } catch { /* 무시 */ }
        }, 3000);
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
  private _timeoutSeconds = 30;

  // 모든 서버의 타임아웃 설정 (초 단위)
  setTimeout(seconds: number): void {
    this._timeoutSeconds = seconds;
    for (const server of this.servers.values()) {
      server.setTimeoutSeconds(seconds);
    }
  }

  // 설정 로드 및 서버 연결
  async loadConfig(configJson: string): Promise<{ connected: string[]; failed: string[] }> {
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
        // 현재 설정된 타임아웃 적용
        conn.setTimeoutSeconds(this._timeoutSeconds);
        this.servers.set(name, conn);
        connected.push(name);
      } catch (error) {
        console.error(`[MCP] ${name} 연결 실패:`, error);
        failed.push(name);
      }
    }

    return { connected, failed };
  }

  // 모든 MCP 도구 목록
  getAllTools(): ToolDefinition[] {
    const tools: ToolDefinition[] = [];
    for (const server of this.servers.values()) {
      if (server.connected) tools.push(...server.tools);
    }
    return tools;
  }

  // MCP 도구 실행 (접두사 기반으로 서버 라우팅)
  async executeTool(prefixedName: string, input: Record<string, unknown>): Promise<string> {
    const match = prefixedName.match(/^mcp_([^_]+)_(.+)$/);
    if (!match) return `잘못된 MCP 도구 이름: ${prefixedName}`;

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
      status.push({ name, connected: server.connected, toolCount: server.tools.length });
    }
    return status;
  }

  // 모든 서버 종료
  disconnectAll(): void {
    for (const server of this.servers.values()) server.disconnect();
    this.servers.clear();
  }
}
