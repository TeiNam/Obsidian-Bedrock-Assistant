import { Plugin, TFile, addIcon } from "obsidian";
import { BedrockClient } from "./bedrock-client";
import { VaultIndexer } from "./vault-indexer";
import { ToolExecutor } from "./obsidian-tools";
import { ChatView, VIEW_TYPE } from "./chat-view";
import { BedrockSettingTab } from "./settings-tab";
import { McpManager } from "./mcp-client";
import { DEFAULT_SETTINGS, type BedrockAssistantSettings, type ChatMessage, type ChatSession } from "./types";

const INDEX_FILE = ".assistant-kiro-index.json";
const CHAT_HISTORY_FILE = ".assistant-kiro-chat.json";
const CHAT_SESSIONS_FILE = ".assistant-kiro-sessions.json";
const MCP_CONFIG_FILE = "mcp.json";

// 커스텀 Kiro 아이콘 (icon.svg 기반, viewBox 맞춤)
const KIRO_ICON = `<svg viewBox="0 0 1200 1200" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="1200" height="1200" rx="260" fill="#9046FF"/><mask id="m" style="mask-type:luminance" maskUnits="userSpaceOnUse" x="272" y="202" width="655" height="796"><path d="M926.578 202.793H272.637V997.857H926.578V202.793Z" fill="white"/></mask><g mask="url(#m)"><path d="M398.554 818.914C316.315 1001.03 491.477 1046.74 620.672 940.156C658.687 1059.66 801.052 970.473 852.234 877.795C964.787 673.567 919.318 465.357 907.64 422.374C827.637 129.443 427.623 128.946 358.8 423.865C342.651 475.544 342.402 534.18 333.458 595.051C328.986 625.86 325.507 645.488 313.83 677.785C306.873 696.424 297.68 712.819 282.773 740.645C259.915 783.881 269.604 867.113 387.87 823.883L399.051 818.914H398.554Z" fill="white"/><path d="M636.123 549.353C603.328 549.353 598.359 510.097 598.359 486.742C598.359 465.623 602.086 448.977 609.293 438.293C615.504 428.852 624.697 424.131 636.123 424.131C647.555 424.131 657.492 428.852 664.447 438.541C672.398 449.474 676.623 466.12 676.623 486.742C676.623 525.998 661.471 549.353 636.375 549.353H636.123Z" fill="currentColor"/><path d="M771.24 549.353C738.445 549.353 733.477 510.097 733.477 486.742C733.477 465.623 737.203 448.977 744.41 438.293C750.621 428.852 759.814 424.131 771.24 424.131C782.672 424.131 792.609 428.852 799.564 438.541C807.516 449.474 811.74 466.12 811.74 486.742C811.74 525.998 796.588 549.353 771.492 549.353H771.24Z" fill="currentColor"/></g></svg>`;
export const KIRO_ICON_ID = "kiro-assistant";

export default class BedrockAssistantPlugin extends Plugin {
  settings: BedrockAssistantSettings;
  bedrockClient: BedrockClient;
  indexer: VaultIndexer;
  toolExecutor: ToolExecutor;
  mcpManager: McpManager;

  async onload(): Promise<void> {
    await this.loadSettings();

    // 커스텀 아이콘 등록
    addIcon(KIRO_ICON_ID, KIRO_ICON);

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
    this.addRibbonIcon(KIRO_ICON_ID, "Assistant Kiro", () => {
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
    return `${this.app.vault.configDir}/plugins/assistant-kiro/${MCP_CONFIG_FILE}`;
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
