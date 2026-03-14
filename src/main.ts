import { Notice, Plugin, TFile, addIcon, setIcon } from "obsidian";
import { VaultIndexer } from "./vault-indexer";
import { ToolExecutor } from "./obsidian-tools";
import { ChatView, VIEW_TYPE } from "./chat-view";
import { GeminiSettingTab } from "./settings-tab";
import { McpManager } from "./mcp-client";
import { DEFAULT_SETTINGS, type GeminiAssistantSettings, type IAiClient, type ChatMessage, type ChatSession } from "./types";
import { BRANDING, updateBranding, getBranding } from "./branding";
import { loadSessionsWithRecovery, saveSessionsWithBackup, type FileAdapter } from "./session-recovery";
import {
  decryptSettings,
  stripSensitiveFields,
  saveCredentialsToLocal,
  loadCredentialsFromLocal,
  SENSITIVE_FIELDS,
} from "./safe-storage";
import { createAiClient } from "./ai-client-factory";

const INDEX_FILE = BRANDING.files.index;
const CHAT_HISTORY_FILE = BRANDING.files.chatHistory;
const CHAT_SESSIONS_FILE = BRANDING.files.sessions;
const CHAT_SESSIONS_BACKUP_FILE = BRANDING.files.sessionsBackup;
const MCP_CONFIG_FILE = "mcp.json";

export default class GeminiAssistantPlugin extends Plugin {
  settings!: GeminiAssistantSettings;
  aiClient!: IAiClient;
  indexer!: VaultIndexer;
  toolExecutor!: ToolExecutor;
  mcpManager!: McpManager;
  // 인덱싱 진행률 표시용 상태바 아이템
  private statusBarItem!: HTMLElement;
  // 리본 아이콘 엘리먼트 참조 (브랜딩 전환 시 갱신용)
  private ribbonIconEl!: HTMLElement;
  // modify 이벤트 파일별 디바운스 타이머
  private indexDebounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

  async onload(): Promise<void> {
    await this.loadSettings();

    // 초기 브랜딩 설정 (로드된 설정의 aiBackend에 맞게 갱신)
    updateBranding(this.settings.aiBackend);

    // 커스텀 아이콘 등록 — 양쪽 백엔드 아이콘 모두 등록 (전환 시 즉시 사용 가능하도록)
    this.registerBrandingIcons();

    // AI 클라이언트 초기화 (팩토리 패턴으로 백엔드에 따라 적절한 클라이언트 생성)
    this.aiClient = createAiClient(this.settings);

    // 볼트 인덱서 초기화
    this.indexer = new VaultIndexer(this.app, this.aiClient);

    // 도구 실행기 초기화
    this.toolExecutor = new ToolExecutor(this.app, this.indexer, () => this.settings.templateFolder);

    // MCP 매니저 초기화 및 타임아웃 설정 적용
    this.mcpManager = new McpManager();
    this.mcpManager.setTimeout(this.settings.mcpTimeout);

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
    }).catch((e) => console.error("MCP 설정 로드 실패:", e));

    // 인덱스 로드는 레이아웃 준비 후 실행 (볼트 파일 시스템이 완전히 준비된 상태에서 로드)
    this.app.workspace.onLayoutReady(() => {
      this.loadIndex().catch((e) => console.error("인덱스 로드 실패:", e));
    });

    // 리본 아이콘 추가
    this.ribbonIconEl = this.addRibbonIcon(BRANDING.icon.id, BRANDING.displayName, () => {
      this.activateView();
    });

    // 설정 탭 추가
    this.addSettingTab(new GeminiSettingTab(this.app, this));

    // 인덱싱 진행률 표시용 상태바 아이템 등록
    this.statusBarItem = this.addStatusBarItem();

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
        // 상태바에 인덱싱 진행률 표시
        this.statusBarItem.setText("인덱싱 중... 0%");
        await this.indexer.indexVault((current, total) => {
          const percent = Math.round((current / total) * 100);
          this.statusBarItem.setText(`인덱싱 중... ${percent}%`);
        });
        // 완료 표시 후 3초 뒤 텍스트 제거
        this.statusBarItem.setText("인덱싱 완료 ✓");
        setTimeout(() => {
          this.statusBarItem.setText("");
        }, 3000);
        await this.saveIndex();
      },
    });

    // 파일 변경 감지 → 인덱스 자동 업데이트 (파일별 2초 디바운스)
    // indexVault 진행 중에는 modify 이벤트 인덱싱을 건너뛰어 동시 실행 방지
    this.registerEvent(
      this.app.vault.on("modify", async (file) => {
        if (file instanceof TFile && file.extension === "md" && !this.indexer.isIndexing) {
          // 기존 타이머 취소
          const existing = this.indexDebounceTimers.get(file.path);
          if (existing) clearTimeout(existing);
          // 2초 디바운스
          const timer = setTimeout(async () => {
            this.indexDebounceTimers.delete(file.path);
            try { await this.indexer.indexFile(file); } catch { }
          }, 2000);
          this.indexDebounceTimers.set(file.path, timer);
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
    // 디바운스 타이머 정리
    for (const timer of this.indexDebounceTimers.values()) {
      clearTimeout(timer);
    }
    this.indexDebounceTimers.clear();

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
    const raw = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());

    // 마이그레이션: data.json에 암호화된 키가 남아있으면 로컬로 이전 후 제거
    let hasMigratedKeys = false;
    for (const field of SENSITIVE_FIELDS) {
      const val = (raw as Record<string, unknown>)[field];
      if (typeof val === "string" && val.length > 0) {
        hasMigratedKeys = true;
        break;
      }
    }

    if (hasMigratedKeys) {
      // 기존 data.json의 키를 복호화 후 로컬 파일로 저장
      const decrypted = decryptSettings(raw);
      saveCredentialsToLocal(decrypted as unknown as Record<string, unknown>);
      // data.json에서 민감 필드 제거하여 저장
      const stripped = stripSensitiveFields(decrypted);
      await this.saveData(stripped);
      this.settings = decrypted;
    } else {
      // 로컬 전용 파일에서 자격증명 로드
      const credentials = loadCredentialsFromLocal();
      this.settings = { ...raw, ...credentials } as GeminiAssistantSettings;
    }
  }

  async saveSettings(): Promise<void> {
    // 민감 필드는 로컬 전용 파일에 암호화하여 저장 (iCloud 동기화 안 됨)
    saveCredentialsToLocal(this.settings as unknown as Record<string, unknown>);
    // data.json에는 민감 필드를 제거하여 저장 (iCloud 동기화 대상)
    const stripped = stripSensitiveFields(this.settings);
    await this.saveData(stripped);
    this.aiClient?.updateSettings(this.settings);
    // 브랜딩을 현재 백엔드에 맞게 갱신
    updateBranding(this.settings.aiBackend);
  }

  /** 백엔드 전환 시 기존 클라이언트를 폐기하고 새 클라이언트를 생성한다 */
  recreateAiClient(): void {
    this.aiClient = createAiClient(this.settings);
    // 인덱서의 AI 클라이언트 참조도 갱신
    this.indexer.client = this.aiClient;
  }

  /** 양쪽 백엔드의 커스텀 아이콘을 모두 등록한다 (전환 시 즉시 사용 가능) */
  private registerBrandingIcons(): void {
    const bedrock = getBranding("bedrock");
    const gemini = getBranding("gemini");
    if (bedrock.icon.svg) addIcon(bedrock.icon.id, bedrock.icon.svg);
    if (gemini.icon.svg) addIcon(gemini.icon.id, gemini.icon.svg);
  }

  /** 백엔드 전환 후 리본 아이콘, 뷰 탭 등 UI 브랜딩을 갱신한다 */
  refreshBranding(): void {
    // 리본 아이콘 갱신
    if (this.ribbonIconEl) {
      this.ribbonIconEl.empty();
      setIcon(this.ribbonIconEl, BRANDING.icon.id);
      this.ribbonIconEl.setAttribute("aria-label", BRANDING.displayName);
    }
    // 열려있는 뷰의 탭 아이콘/타이틀 갱신
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE);
    for (const leaf of leaves) {
      // Obsidian의 leaf 탭 UI를 갱신하기 위해 뷰 상태를 다시 설정
      (leaf as any).updateHeader?.();
    }
  }

  // 인덱스 로드/저장
  async loadIndex(): Promise<void> {
    try {
      // 숨김 파일은 getAbstractFileByPath 캐시에 없을 수 있으므로 adapter를 직접 사용
      const exists = await this.app.vault.adapter.exists(INDEX_FILE);
      if (exists) {
        const data = await this.app.vault.adapter.read(INDEX_FILE);
        this.indexer.deserialize(data);
      }
    } catch {
      // 인덱스 파일 없으면 무시
    }
  }

  async saveIndex(): Promise<void> {
    try {
      const data = this.indexer.serialize();
      // 숨김 파일은 getAbstractFileByPath 캐시에 없을 수 있으므로 adapter를 직접 사용
      await this.app.vault.adapter.write(INDEX_FILE, data);
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
        try {
          await this.app.vault.create(CHAT_HISTORY_FILE, data);
        } catch {
          // race condition: 다른 호출이 먼저 파일을 생성한 경우
          const retry = this.app.vault.getAbstractFileByPath(CHAT_HISTORY_FILE);
          if (retry && retry instanceof TFile) {
            await this.app.vault.modify(retry, data);
          }
        }
      }
    } catch (error) {
      console.error("대화 히스토리 저장 실패:", error);
    }
  }

  // Obsidian Vault API를 FileAdapter 인터페이스로 감싸는 어댑터 생성
  private createVaultFileAdapter(): FileAdapter {
    const vault = this.app.vault;
    return {
      exists: async (path: string): Promise<boolean> => {
        return await vault.adapter.exists(path);
      },
      read: async (path: string): Promise<string> => {
        return await vault.adapter.read(path);
      },
      write: async (path: string, data: string): Promise<void> => {
        const file = vault.getAbstractFileByPath(path);
        if (file && file instanceof TFile) {
          await vault.modify(file, data);
        } else {
          // 캐시에 없지만 파일은 존재할 수 있으므로 adapter로 직접 쓰기
          await vault.adapter.write(path, data);
        }
      },
      create: async (path: string, data: string): Promise<void> => {
        try {
          await vault.create(path, data);
        } catch {
          // race condition: 다른 호출이 먼저 파일을 생성한 경우
          // getAbstractFileByPath 캐시가 stale할 수 있으므로 adapter를 직접 사용
          const existing = vault.getAbstractFileByPath(path);
          if (existing && existing instanceof TFile) {
            await vault.modify(existing, data);
          } else {
            // 캐시에 없지만 파일은 존재하는 경우 adapter로 직접 쓰기
            await vault.adapter.write(path, data);
          }
        }
      },
    };
  }

  // 세션 목록 로드 (session-recovery.ts 모듈 활용)
  async loadSessions(): Promise<ChatSession[]> {
    try {
      const adapter = this.createVaultFileAdapter();
      const result = await loadSessionsWithRecovery(adapter, CHAT_SESSIONS_FILE, CHAT_SESSIONS_BACKUP_FILE);

      if (result.recovered) {
        new Notice("세션 파일이 손상되어 백업에서 복구했습니다.");
      } else if (result.error) {
        new Notice("세션 파일 복구에 실패했습니다. 새로운 세션으로 시작합니다.");
      }

      return result.sessions;
    } catch (error) {
      console.error("세션 로드 실패:", error);
      // fallback: 직접 Vault API로 로드 시도
      try {
        const file = this.app.vault.getAbstractFileByPath(CHAT_SESSIONS_FILE);
        if (file && file instanceof TFile) {
          const data = await this.app.vault.read(file);
          return JSON.parse(data) as ChatSession[];
        }
      } catch (fallbackError) {
        console.error("세션 로드 fallback 실패:", fallbackError);
      }
      return [];
    }
  }

  // 세션 목록 저장 (session-recovery.ts 모듈 활용)
  async saveSessions(sessions: ChatSession[]): Promise<void> {
    try {
      const adapter = this.createVaultFileAdapter();
      await saveSessionsWithBackup(adapter, sessions, CHAT_SESSIONS_FILE, CHAT_SESSIONS_BACKUP_FILE);
    } catch (error) {
      console.error("세션 저장 실패:", error);
      // fallback: 직접 Vault API로 저장 시도
      try {
        const data = JSON.stringify(sessions);
        const file = this.app.vault.getAbstractFileByPath(CHAT_SESSIONS_FILE);
        if (file && file instanceof TFile) {
          await this.app.vault.modify(file, data);
        } else {
          try {
            await this.app.vault.create(CHAT_SESSIONS_FILE, data);
          } catch {
            const retry = this.app.vault.getAbstractFileByPath(CHAT_SESSIONS_FILE);
            if (retry && retry instanceof TFile) {
              await this.app.vault.modify(retry, data);
            }
          }
        }
      } catch (fallbackError) {
        console.error("세션 저장 fallback 실패:", fallbackError);
      }
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
    return `${this.app.vault.configDir}/plugins/${BRANDING.pluginId}/${MCP_CONFIG_FILE}`;
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
