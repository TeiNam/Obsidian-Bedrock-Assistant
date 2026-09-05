import { ChildProcess, spawn } from "child_process";
import { existsSync } from "fs";
import { delimiter, isAbsolute, join } from "path";
import type { ToolDefinition } from "./types";
import { BRANDING } from "./branding";
import { formatToolError } from "./tool-failure-tracker";
import { noticeI18n } from "./notice-i18n";
import { toolI18n } from "./tool-result-i18n";
import { getErrorMessage } from "./error-utils";
import type { Locale } from "./types";

// PATH에서 실행 파일의 절대 경로를 찾는 유틸리티 (GUI 앱에서 which 대체)
function resolveCommand(command: string, pathEnv: string): string {
  if (isAbsolute(command)) return command;
  for (const dir of pathEnv.split(delimiter)) {
    if (!dir) continue;
    const full = join(dir, command);
    if (existsSync(full)) return full;
  }
  return command;
}

/** 운영체제 PATH 구분자로 빈 항목 없이 결합한다. */
export function joinSearchPath(paths: readonly string[], separator = delimiter): string {
  return paths.filter(Boolean).join(separator);
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * MCP 설정 JSON을 실제 사용 가능한 구조인지 검증한다.
 *
 * 여기서 던지는 메시지는 MCP 설정 모달에 그대로 표시되므로 사용자 언어를 따른다.
 * (도구 실행 경로의 오류 문구는 LLM이 읽는 값이라 번역하지 않는다 — formatToolError 참조.)
 */
export function parseMcpConfig(configJson: string, locale?: Locale): McpConfig {
  const t = noticeI18n(locale);
  const parsed: unknown = JSON.parse(configJson);
  if (!isRecord(parsed) || !isRecord(parsed.mcpServers)) {
    throw new Error(t.mcpConfigNeedsServers);
  }

  for (const [name, raw] of Object.entries(parsed.mcpServers)) {
    if (name.trim() === "") throw new Error(t.mcpConfigEmptyName);
    if (!isRecord(raw)) throw new Error(t.mcpConfigNotObject(name));
    if (typeof raw.command !== "string" || raw.command.trim() === "") {
      throw new Error(t.mcpConfigBadCommand(name));
    }
    if (raw.args !== undefined && (!Array.isArray(raw.args) || !raw.args.every((v) => typeof v === "string"))) {
      throw new Error(t.mcpConfigBadArgs(name));
    }
    if (raw.env !== undefined) {
      if (!isRecord(raw.env) || !Object.values(raw.env).every((v) => typeof v === "string")) {
        throw new Error(t.mcpConfigBadEnv(name));
      }
    }
    if (raw.disabled !== undefined && typeof raw.disabled !== "boolean") {
      throw new Error(t.mcpConfigBadDisabled(name));
    }
  }

  return parsed as unknown as McpConfig;
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

/** 텍스트 외 이미지·리소스 블록도 버리지 않고 JSON으로 보존한다. */
export function formatMcpToolResult(result: unknown): string {
  // JSON.stringify 는 undefined·함수·심볼에서 undefined 를 돌려주므로 빈 문자열로 떨어뜨린다.
  if (!isRecord(result)) return JSON.stringify(result) ?? "";

  const parts: string[] = [];
  if (Array.isArray(result.content)) {
    for (const block of result.content) {
      if (isRecord(block) && block.type === "text" && typeof block.text === "string") {
        parts.push(block.text);
      } else {
        const serialized = JSON.stringify(block);
        if (serialized !== undefined) parts.push(serialized);
      }
    }
  }
  if (result.structuredContent !== undefined) {
    const serialized = JSON.stringify(result.structuredContent);
    if (serialized !== undefined) parts.push(serialized);
  }
  return parts.filter((part): part is string => typeof part === "string" && part !== "").join("\n")
    || JSON.stringify(result)
    || "";
}

/** MCP stdio 전송 규격: JSON-RPC 메시지 하나를 한 줄로 보낸다. */
export function encodeMcpStdioMessage(message: unknown): string {
  return `${JSON.stringify(message)}\n`;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: number;
}

// 단일 MCP 서버 연결
class McpServerConnection {
  readonly name: string;
  private config: McpServerConfig;
  private process: ChildProcess | null = null;
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();
  private buffer = "";
  private _tools: ToolDefinition[] = [];
  private _connected = false;
  // MCP 요청 타임아웃 (밀리초)
  private _timeoutMs = 30000;
  // 오류 문구 표시 언어 (McpManager가 주입)
  private _locale: Locale | undefined;

  // 자동 재연결 관련 속성
  private reconnectAttempts = 0;
  private static MAX_RECONNECT = 3;
  private static RECONNECT_DELAY = 5000; // 5초
  private intentionalDisconnect = false;
  private reconnectTimer: number | null = null;

  // 재연결 성공 시 호출되는 콜백 (McpManager에서 도구 목록 갱신용)
  onReconnect: (() => void) | null = null;

  constructor(name: string, config: McpServerConfig) {
    this.name = name;
    this.config = config;
  }

  // 타임아웃 설정 (초 단위 입력 → 밀리초로 변환)
  setTimeoutSeconds(seconds: number): void {
    this._timeoutMs = seconds * 1000;
  }

  /**
   * 오류 문구의 표시 언어. 이 오류들은 도구 결과로 화면에 그대로 뜨므로 번역 대상이다.
   *
   * 연결 객체는 플러그인 설정을 참조하지 않으므로 McpManager가 주입한다(타임아웃과 같은 경로).
   */
  setLocale(locale: Locale | undefined): void {
    this._locale = locale;
  }

  /** 현재 언어의 도구 결과 레이블. */
  private get t() {
    return toolI18n(this._locale);
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
    const home = process.env.HOME || process.env.USERPROFILE;
    const extraPaths = [
      ...(process.platform === "win32" ? [] : ["/usr/local/bin", "/opt/homebrew/bin"]),
      ...(home ? [join(home, ".local", "bin"), join(home, ".cargo", "bin")] : []),
    ];
    const currentPath = process.env.PATH || (process.platform === "win32" ? "" : "/usr/bin:/bin");
    const augmentedPath = joinSearchPath([...extraPaths, currentPath]);
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
      console.error(`[MCP:${this.name}] stderr:`, data.toString().trim());
    });

    this.process.on("error", (err) => {
      console.error(`[MCP:${this.name}] 프로세스 오류:`, err);
      this._connected = false;
    });

    this.process.on("exit", (code) => {
      this._connected = false;
      for (const [, p] of this.pending) {
        window.clearTimeout(p.timer);
        p.reject(new Error(this.t.mcpServerExited(code)));
      }
      this.pending.clear();

      // 비정상 종료 시 자동 재연결 시도
      if (!this.intentionalDisconnect && code !== 0 && this.reconnectAttempts < McpServerConnection.MAX_RECONNECT) {
        this.reconnectAttempts++;
        this.reconnectTimer = window.setTimeout(() => {
          this.reconnectTimer = null;
          if (this.intentionalDisconnect) return;
          this.connect().then(() => {
            this.reconnectAttempts = 0; // 재연결 성공 시 리셋
            if (this.onReconnect) this.onReconnect();
          }).catch(() => {
            console.error(`[MCP:${this.name}] 재연결 실패 (${this.reconnectAttempts}/${McpServerConnection.MAX_RECONNECT})`);
          });
        }, McpServerConnection.RECONNECT_DELAY);
      }
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
      this.intentionalDisconnect = false; // 연결 성공 시 의도적 종료 플래그 리셋

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
    })) as { content?: unknown[]; structuredContent?: unknown; isError?: boolean };

    const text = formatMcpToolResult(result);
    return result.isError
      ? formatToolError(
          this.t.mcpToolFailed(originalName, text || this.t.mcpToolFailedNoDetail),
          this._locale
        )
      : text;
  }

  // JSON-RPC 요청 전송
  private sendRequest(method: string, params: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.process?.stdin?.writable) {
        reject(new Error(this.t.mcpNotConnected));
        return;
      }

      const id = this.nextId++;
      const request: JsonRpcRequest = { jsonrpc: "2.0", id, method, params };
      const timer = window.setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(this.t.mcpRequestTimeout(method)));
        }
      }, this._timeoutMs);
      this.pending.set(id, { resolve, reject, timer });

      try {
        this.process.stdin.write(encodeMcpStdioMessage(request));
      } catch (error) {
        window.clearTimeout(timer);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(getErrorMessage(error)));
      }
    });
  }

  // JSON-RPC 알림 전송 (응답 없음)
  private sendNotification(method: string, params: Record<string, unknown>): void {
    if (!this.process?.stdin?.writable) return;
    this.process.stdin.write(encodeMcpStdioMessage({ jsonrpc: "2.0", method, params }));
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
          window.clearTimeout(p.timer);
          if (msg.error) {
            p.reject(new Error(this.t.mcpError(msg.error.message)));
          } else {
            p.resolve(msg.result);
          }
        } else if (msg.id !== undefined && !this.pending.has(msg.id)) {
          // 타임아웃으로 pending Map에서 제거된 요청에 대한 늦은 응답
        }
      } catch {
        // JSON 파싱 실패 무시
      }
    }

  // 서버 연결 종료
  disconnect(): void {
    this.intentionalDisconnect = true; // 의도적 종료 표시
    if (this.reconnectTimer) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
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
      window.setTimeout(() => {
        try { if (!proc.killed) proc.kill("SIGKILL"); } catch { /* 무시 */ }
      }, 3000);
      this.process = null;
    }
    for (const [, p] of this.pending) {
      window.clearTimeout(p.timer);
      p.reject(new Error(this.t.mcpConnectionClosed));
    }
    this.pending.clear();
  }
}

// MCP 서버 매니저 — 여러 서버를 관리
export class McpManager {
  private servers = new Map<string, McpServerConnection>();
  private config: McpConfig = { mcpServers: {} };
  private _timeoutSeconds = 30;
  private _locale: Locale | undefined;
  // prefixedName → serverName 매핑 (서버 이름에 _가 포함된 경우에도 정확한 라우팅 보장)
  private toolServerMap = new Map<string, string>();

  /** 모든 서버의 오류 문구 표시 언어를 설정한다. 이후 새로 만드는 연결에도 적용된다. */
  setLocale(locale: Locale | undefined): void {
    this._locale = locale;
    for (const server of this.servers.values()) {
      server.setLocale(locale);
    }
  }

  // 모든 서버의 타임아웃 설정 (초 단위)
  setTimeout(seconds: number): void {
    this._timeoutSeconds = seconds;
    for (const server of this.servers.values()) {
      server.setTimeoutSeconds(seconds);
    }
  }

  // toolServerMap 갱신 — 서버의 도구 목록에서 prefixedName → serverName 매핑 생성
  private updateToolServerMap(): void {
    this.toolServerMap.clear();
    for (const [serverName, server] of this.servers) {
      if (!server.connected) continue;
      for (const tool of server.tools) {
        this.toolServerMap.set(tool.name, serverName);
      }
    }
  }

  // 설정 로드 및 서버 연결
  async loadConfig(configJson: string, locale?: Locale): Promise<{ connected: string[]; failed: string[] }> {
    // 여기서 setLocale()로 기존 연결에 전파하지 않는다 — 이 함수가 곧 전부 교체하므로
    // 의미가 없고, 파싱 실패로 되돌아갈 때 낡은 연결을 건드린 흔적만 남는다.
    // 새 연결은 생성 시점에 _locale을 받는다.
    if (locale !== undefined) this._locale = locale;
    const nextConfig = parseMcpConfig(configJson, locale);
    this.disconnectAll();
    this.config = nextConfig;

    const connected: string[] = [];
    const failed: string[] = [];

    for (const [name, serverConfig] of Object.entries(this.config.mcpServers)) {
      if (serverConfig.disabled) continue;
      const conn = new McpServerConnection(name, serverConfig);
      // initialize/tools/list도 사용자 설정 타임아웃을 사용해야 한다.
      conn.setTimeoutSeconds(this._timeoutSeconds);
      conn.setLocale(this._locale);
      conn.onReconnect = () => this.updateToolServerMap();
      try {
        await conn.connect();
        this.servers.set(name, conn);
        connected.push(name);
      } catch (error) {
        console.error(`[MCP] ${name} 연결 실패:`, error);
        failed.push(name);
      }
    }

    // 도구 등록 후 toolServerMap 갱신
    this.updateToolServerMap();

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

  // 모든 서버의 도구 목록 갱신 후 toolServerMap 업데이트
  async refreshAllTools(): Promise<void> {
    for (const server of this.servers.values()) {
      if (server.connected) {
        await server.refreshTools();
      }
    }
    this.updateToolServerMap();
  }

  // MCP 도구 실행 (toolServerMap 기반으로 서버 라우팅 — 서버 이름에 _ 포함 시에도 정확히 동작)
  async executeTool(prefixedName: string, input: Record<string, unknown>): Promise<string> {
    const serverName = this.toolServerMap.get(prefixedName);
    if (!serverName) {
      return formatToolError(toolI18n(this._locale).mcpBadToolName(prefixedName), this._locale);
    }

    const server = this.servers.get(serverName);
    if (!server || !server.connected) {
      return formatToolError(toolI18n(this._locale).mcpNotConnectedTo(serverName), this._locale);
    }

    // prefixedName에서 원래 도구 이름 추출: "mcp_{serverName}_{toolName}" 형식
    const prefix = `mcp_${serverName}_`;
    const toolName = prefixedName.slice(prefix.length);

    try {
      return await server.callTool(toolName, input);
    } catch (error) {
      return formatToolError(`MCP ${toolName}: ${(error as Error).message}`);
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
    this.toolServerMap.clear();
  }
}
