import { Plugin, TFile } from "obsidian";
import { BedrockClient } from "./bedrock-client";
import { VaultIndexer } from "./vault-indexer";
import { ToolExecutor } from "./obsidian-tools";
import { ChatView, VIEW_TYPE } from "./chat-view";
import { BedrockSettingTab } from "./settings-tab";
import { McpManager } from "./mcp-client";
import { DEFAULT_SETTINGS, type BedrockAssistantSettings, type ChatMessage, type ChatSession } from "./types";

const INDEX_FILE = ".bedrock-assistant-index.json";
const CHAT_HISTORY_FILE = ".bedrock-assistant-chat.json";
const CHAT_SESSIONS_FILE = ".bedrock-assistant-sessions.json";
const MCP_CONFIG_FILE = "mcp.json";

// 내장 봇 아이콘 사용
export const BOT_ICON_ID = "bot";

export default class BedrockAssistantPlugin extends Plugin {
  settings: BedrockAssistantSettings;
  bedrockClient: BedrockClient;
  indexer: VaultIndexer;
  toolExecutor: ToolExecutor;
  mcpManager: McpManager;

  async onload(): Promise<void> {
    await this.loadSettings();

    // 내장 아이콘 사용 (addIcon 불필요)

    // Bedrock 클라이언트 초기화
    this.bedrockClient = new BedrockClient(this.settings);

    // 볼트 인덱서 초기화
    this.indexer = new VaultIndexer(this.app, this.bedrockClient);

    // 도구 실행기 초기화
    this.toolExecutor = new ToolExecutor(this.app, this.indexer, () => this.settings.templateFolder);

    // MCP 매니저 초기화
    this.mcpManager = new McpManager();

    // 사이드바 뷰 등록 (MCP 로드보다 먼저 등록해야 레이아웃 복원 시 뷰가 준비됨)
    this.registerView(VIEW_TYPE, (leaf) => new ChatView(leaf, this));

    // MCP 연결 및 인덱스 로드는 플러그인 로딩을 블로킹하지 않도록 백그라운드 처리
    this.loadMcpConfig().then(() => {
      // MCP 연결 완료 후 채팅 뷰의 인디케이터 갱신
      const refreshMcpIndicator = () => {
        const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE);
        for (const leaf of leaves) {
          (leaf.view as any).updateMcpIndicator?.();
        }
      };
      refreshMcpIndicator();
      // 레이아웃이 아직 준비 안 됐을 수 있으므로 준비 후에도 한 번 더 갱신
      this.app.workspace.onLayoutReady(() => refreshMcpIndicator());
    }).catch((e) => console.warn("MCP 설정 로드 실패:", e));
    this.loadIndex().catch((e) => console.warn("인덱스 로드 실패:", e));

    // 리본 아이콘 추가
    this.addRibbonIcon(BOT_ICON_ID, "Bedrock Assistant", () => {
      this.activateView();
    });

    // 설정 탭 추가
    this.addSettingTab(new BedrockSettingTab(this.app, this));

    // 커맨드 등록
    this.addCommand({
      id: "open-assistant",
      name: "어시스턴트 열기",
      callback: () => this.activateView(),
    });

    this.addCommand({
      id: "index-vault",
      name: "볼트 인덱싱",
      callback: async () => {
        await this.indexer.indexVault();
        await this.saveIndex();
      },
    });

    // 파일 변경 감지 → 인덱스 자동 업데이트
    this.registerEvent(
      this.app.vault.on("modify", async (file) => {
        if (file instanceof TFile && file.extension === "md") {
          try {
            await this.indexer.indexFile(file);
          } catch {
            // 자동 인덱싱 실패는 무시
          }
        }
      })
    );

    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        if (file instanceof TFile) {
          this.indexer.removeFile(file.path);
        }
      })
    );
  }

  async onunload(): Promise<void> {
    this.mcpManager?.disconnectAll();
    await this.saveIndex();
  }

  // 사이드바 뷰 활성화
  async activateView(): Promise<void> {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE)[0];

    if (!leaf) {
      const newLeaf = workspace.getRightLeaf(false);
      if (newLeaf) {
        await newLeaf.setViewState({ type: VIEW_TYPE, active: true });
        leaf = newLeaf;
      }
    }

    if (leaf) {
      workspace.revealLeaf(leaf);
    }
  }

  // 설정 로드/저장
  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    this.bedrockClient?.updateSettings(this.settings);
  }

  // 인덱스 로드/저장
  async loadIndex(): Promise<void> {
    try {
      const file = this.app.vault.getAbstractFileByPath(INDEX_FILE);
      if (file && file instanceof TFile) {
        const data = await this.app.vault.read(file);
        this.indexer.deserialize(data);
      }
    } catch {
      // 인덱스 파일 없으면 무시
    }
  }

  async saveIndex(): Promise<void> {
    try {
      const data = this.indexer.serialize();
      const file = this.app.vault.getAbstractFileByPath(INDEX_FILE);
      if (file && file instanceof TFile) {
        await this.app.vault.modify(file, data);
      } else {
        await this.app.vault.create(INDEX_FILE, data);
      }
    } catch (error) {
      console.error("인덱스 저장 실패:", error);
    }
  }

  // 대화 히스토리 로드/저장 (현재 세션 — 하위 호환)
  async loadChatHistory(): Promise<ChatMessage[]> {
    if (!this.settings.persistChat) return [];
    try {
      const file = this.app.vault.getAbstractFileByPath(CHAT_HISTORY_FILE);
      if (file && file instanceof TFile) {
        const data = await this.app.vault.read(file);
        return JSON.parse(data) as ChatMessage[];
      }
    } catch {
      // 히스토리 파일 없거나 파싱 실패 시 빈 배열
    }
    return [];
  }

  async saveChatHistory(messages: ChatMessage[]): Promise<void> {
    if (!this.settings.persistChat) return;
    try {
      const data = JSON.stringify(messages);
      const file = this.app.vault.getAbstractFileByPath(CHAT_HISTORY_FILE);
      if (file && file instanceof TFile) {
        await this.app.vault.modify(file, data);
      } else {
        await this.app.vault.create(CHAT_HISTORY_FILE, data);
      }
    } catch (error) {
      console.error("대화 히스토리 저장 실패:", error);
    }
  }

  // 세션 목록 로드
  async loadSessions(): Promise<ChatSession[]> {
    try {
      const file = this.app.vault.getAbstractFileByPath(CHAT_SESSIONS_FILE);
      if (file && file instanceof TFile) {
        const data = await this.app.vault.read(file);
        return JSON.parse(data) as ChatSession[];
      }
    } catch {
      // 파일 없거나 파싱 실패
    }
    return [];
  }

  // 세션 목록 저장
  async saveSessions(sessions: ChatSession[]): Promise<void> {
    try {
      const data = JSON.stringify(sessions);
      const file = this.app.vault.getAbstractFileByPath(CHAT_SESSIONS_FILE);
      if (file && file instanceof TFile) {
        await this.app.vault.modify(file, data);
      } else {
        await this.app.vault.create(CHAT_SESSIONS_FILE, data);
      }
    } catch (error) {
      console.error("세션 저장 실패:", error);
    }
  }

  // 현재 대화를 세션으로 저장
  async saveCurrentAsSession(messages: ChatMessage[]): Promise<void> {
    if (messages.length === 0) return;
    const sessions = await this.loadSessions();
    // 첫 번째 사용자 메시지에서 제목 추출
    const firstUserMsg = messages.find(m => m.role === "user");
    const title = firstUserMsg
      ? firstUserMsg.content.slice(0, 50) + (firstUserMsg.content.length > 50 ? "..." : "")
      : "Untitled";
    const now = Date.now();
    const session: ChatSession = {
      id: `session-${now}`,
      title,
      createdAt: messages[0]?.timestamp || now,
      updatedAt: now,
      messages,
    };
    sessions.unshift(session);
    // 최대 50개 세션 유지
    if (sessions.length > 50) sessions.length = 50;
    await this.saveSessions(sessions);
  }

  // 모든 세션 삭제
  async clearAllSessions(): Promise<void> {
    await this.saveSessions([]);
    // 현재 히스토리 파일도 삭제
    try {
      const file = this.app.vault.getAbstractFileByPath(CHAT_HISTORY_FILE);
      if (file && file instanceof TFile) {
        await this.app.vault.modify(file, "[]");
      }
    } catch { /* 무시 */ }
  }

  // MCP 설정 파일 경로 (플러그인 폴더 내)
  getMcpConfigPath(): string {
    return `${this.app.vault.configDir}/plugins/bedrock-assistant/${MCP_CONFIG_FILE}`;
  }

  // MCP 설정 로드 및 서버 연결
  async loadMcpConfig(): Promise<{ connected: string[]; failed: string[] }> {
    const configPath = this.getMcpConfigPath();
    try {
      const adapter = this.app.vault.adapter;
      if (await adapter.exists(configPath)) {
        const data = await adapter.read(configPath);
        return await this.mcpManager.loadConfig(data);
      }
    } catch (error) {
      console.error("MCP 설정 로드 실패:", error);
    }
    return { connected: [], failed: [] };
  }

  // MCP 설정 저장
  async saveMcpConfig(configJson: string): Promise<void> {
    const configPath = this.getMcpConfigPath();
    try {
      await this.app.vault.adapter.write(configPath, configJson);
    } catch (error) {
      console.error("MCP 설정 저장 실패:", error);
    }
  }

  // MCP 설정 읽기
  async readMcpConfig(): Promise<string> {
    const configPath = this.getMcpConfigPath();
    try {
      const adapter = this.app.vault.adapter;
      if (await adapter.exists(configPath)) {
        return await adapter.read(configPath);
      }
    } catch {
      // 파일 없으면 기본값
    }
    return JSON.stringify({ mcpServers: {} }, null, 2);
  }


}
