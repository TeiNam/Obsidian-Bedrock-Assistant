import { Notice, Plugin, TFile, addIcon, setIcon, getAllTags, MarkdownView } from "obsidian";
import { VaultIndexer } from "./vault-indexer";
import type { MetadataSource } from "./graph-rag/graph-extractor";
import { ToolExecutor } from "./obsidian-tools";
import { ChatView, VIEW_TYPE } from "./chat-view";
import { GeminiSettingTab } from "./settings-tab";
import { McpManager } from "./mcp-client";
import { DEFAULT_SETTINGS, normalizeSecondBrainSettings, type GeminiAssistantSettings, type IAiClient, type ChatMessage, type ChatSession } from "./types";
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
import { migratePlannerSettings } from "./planner-settings";
import {
  activeChatModelId,
  clampEffort,
  embeddingSignature,
  legacyTemperatureToEffort,
} from "./provider-utils";
import { LEGACY_DEFAULT_SYSTEM_PROMPTS } from "./system-prompt";
import { SecondBrainScheduler, type SecondBrainContext } from "./second-brain/scheduler";
import { SecondBrainInputModal } from "./modals/second-brain-modals";

/** 파일 변경 → 인덱스 갱신 디바운스 지연(ms). 연속 편집 중 중복 임베딩을 막는다. */
const INDEX_DEBOUNCE_MS = 2000;

const INDEX_FILE = BRANDING.files.index;
const CHAT_HISTORY_FILE = BRANDING.files.chatHistory;
const CHAT_SESSIONS_FILE = BRANDING.files.sessions;
const CHAT_SESSIONS_BACKUP_FILE = BRANDING.files.sessionsBackup;
const MCP_CONFIG_FILE = "mcp.json";

// 신규 사용자를 위한 기본 MCP 설정 템플릿 (웹서치 fetch/brave/exa + time).
// 설정 파일이 없을 때 편집창에 미리 채워주는 용도이며, 저장 전까지는 자동 연결되지 않는다.
// API 키가 필요한 서버는 "your api key" 플레이스홀더를 실제 키로 교체해야 한다.
const DEFAULT_MCP_CONFIG = {
  mcpServers: {
    fetch: {
      command: "docker",
      args: ["run", "-i", "--rm", "mcp/fetch"],
      autoApprove: ["fetch"],
    },
    "brave-search": {
      command: "docker",
      args: ["run", "-i", "--rm", "-e", "BRAVE_API_KEY", "docker.io/mcp/brave-search"],
      env: { BRAVE_API_KEY: "your api key" },
    },
    exa: {
      command: "docker",
      args: ["run", "-i", "--rm", "-e", "EXA_API_KEY", "mcp/exa"],
      env: { EXA_API_KEY: "your api key" },
    },
    time: {
      command: "docker",
      args: ["run", "-i", "--rm", "mcp/time"],
    },
  },
};

/**
 * 비밀값을 변경 감지용 요약 문자열로 환산한다.
 * 길이 + 문자 합 기반 체크섬이라 평문을 보관하지 않으면서도, 같은 접두사로
 * 시작하는 다른 키로 교체된 경우를 구분할 수 있다(암호학적 용도 아님).
 */
function digestSecret(value: string): string {
  const s = value ?? "";
  if (!s) return "0";
  let sum = 0;
  for (let i = 0; i < s.length; i++) {
    // 위치를 곱해 순서가 다른 같은 문자 집합도 구분한다.
    sum = (sum + s.charCodeAt(i) * (i + 1)) % 0xffffffff;
  }
  return `${s.length}-${sum.toString(36)}`;
}

export default class GeminiAssistantPlugin extends Plugin {
  settings!: GeminiAssistantSettings;
  aiClient!: IAiClient;
  indexer!: VaultIndexer;
  toolExecutor!: ToolExecutor;
  mcpManager!: McpManager;
  // Second Brain Layer 스케줄러 (수동 명령 + onLayoutReady 자동 트리거)
  secondBrainScheduler!: SecondBrainScheduler;
  // 인덱싱 진행률 표시용 상태바 아이템
  private statusBarItem!: HTMLElement;
  // 리본 아이콘 엘리먼트 참조 (브랜딩 전환 시 갱신용)
  private ribbonIconEl!: HTMLElement;
  // modify 이벤트 파일별 디바운스 타이머
  private indexDebounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  // 디바운스를 통과한 인덱싱 작업을 직렬 실행하는 체인(동시성 1).
  private indexQueue: Promise<void> = Promise.resolve();
  // 마지막으로 관측한 계정 스코프(백엔드·인증·리전). 변경 시 모델 캐시를 비운다.
  private lastAccountScope = "";

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

    // 옵시디언 metadataCache를 감싸는 MetadataSource 어댑터를 주입 (그래프/태그/프론트매터 추출용)
    this.indexer.setMetadataSource(this.createMetadataSource());
    // 저장된 Graph RAG 검색 설정을 인덱서에 반영 (탐색 깊이/청크 크기/겹침)
    this.applySearchOptions();

    // 도구 실행기 초기화
    // Second Brain Layer 의존성 주입 (Req 11.6, 12.3):
    //  - getSecondBrain: this.settings.secondBrain 동일 참조를 반환(복사본 아님)하여
    //    스케줄러의 lastScheduledRun 갱신이 플러그인 설정에 반영되게 한다.
    //  - getAiClient: 백엔드 전환 시 recreateAiClient로 재할당되는 현재 클라이언트를 항상 반환.
    this.toolExecutor = new ToolExecutor(
      this.app,
      this.indexer,
      () => this.settings.templateFolder,
      () => this.settings.secondBrain,
      () => this.aiClient,
    );

    // Second Brain 스케줄러 초기화 (수동 명령 + onLayoutReady 자동 트리거)
    this.secondBrainScheduler = new SecondBrainScheduler();

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

    // 인덱스 로드 후 Second Brain 스케줄러를 트리거한다 (Req 11.1).
    //
    // 두 작업을 각각 별도 onLayoutReady 콜백으로 등록하면, 인덱스 로드가 첫 await에서
    // 중단된 사이 스케줄러가 시작되어 "빈 인덱스"로 카탈로그를 덮어쓴다. 반드시
    // 로드 완료를 기다린 뒤 실행해야 한다.
    //
    // maybeRunOnStartup 내부에서 enabled·schedulerEnabled·트리거 주기를 모두 검사하므로
    // 여기서는 무조건 호출해도 옵트인 격리가 보장된다(비활성 시 아무 동작 없음).
    this.app.workspace.onLayoutReady(() => {
      void (async () => {
        try {
          await this.loadIndex();
        } catch (e) {
          console.error("인덱스 로드 실패:", e);
        }
        try {
          await this.secondBrainScheduler.maybeRunOnStartup(
            this.buildSecondBrainContext(),
            Date.now()
          );
        } catch (e) {
          console.error("Second Brain 스케줄러 시작 실패:", e);
        }
      })();
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

    // ============================================
    // Second Brain Layer 명령 등록 (Req 12.3)
    // ============================================
    // 모든 능동 동작을 명령 팔레트에 등록한다. 각 명령은 입력이 필요하면 모달로 수집한 뒤,
    // 채팅 도구와 동일한 핸들러(ToolExecutor.execute / 스케줄러)를 호출한다(DRY).
    // 옵트인 격리: enabled=false면 핸들러(execute)·스케줄러가 내부에서 쓰기를 거부한다.
    this.registerSecondBrainCommands();

    // 파일 변경 감지 → 인덱스 자동 업데이트 (파일별 2초 디바운스)
    // indexVault 진행 중이면 indexer가 내부 대기열(pendingFiles)로 큐잉하므로
    // 여기서 걸러내지 않는다. 걸러내면 인덱싱 중 편집이 영구 유실된다.
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (file instanceof TFile && file.extension === "md") {
          this.scheduleIndex(file);
        }
      })
    );

    // 신규 생성 노트도 인덱싱한다. create 이벤트가 없으면 플러그인이 만든 노트
    // (create_note/웹클리퍼/To-Do)가 전체 재인덱싱까지 검색되지 않는다.
    this.registerEvent(
      this.app.vault.on("create", (file) => {
        if (file instanceof TFile && file.extension === "md") {
          this.scheduleIndex(file);
        }
      })
    );

    // 이름 변경/이동: 구 경로 엔트리를 제거하고 새 경로를 인덱싱한다.
    // 이 처리가 없으면 존재하지 않는 노트가 검색 결과에 영구 잔존한다.
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        if (!(file instanceof TFile)) return;
        // 구 경로에 예약된 인덱싱 타이머는 무의미하므로 취소한다.
        const pending = this.indexDebounceTimers.get(oldPath);
        if (pending) {
          clearTimeout(pending);
          this.indexDebounceTimers.delete(oldPath);
        }
        this.indexer.removeFile(oldPath);
        if (file.extension === "md") this.scheduleIndex(file);
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

  /**
   * 파일 인덱싱을 디바운스하여 예약한다(파일별 2초).
   * 연속 편집 중 매 키 입력마다 임베딩을 호출하지 않도록 마지막 변경만 처리한다.
   */
  private scheduleIndex(file: TFile): void {
    const existing = this.indexDebounceTimers.get(file.path);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.indexDebounceTimers.delete(file.path);
      // 직렬 큐에 넣는다. 다중 파일 변경(폴더 이동, 플러그인 일괄 생성)이 동시에
      // 디바운스를 통과하면 파일 수만큼 임베딩 요청이 병렬로 나가 API 쓰로틀링을 맞는다.
      // ponytail: 단일 체인으로 동시성 1 — 처리량이 문제되면 워커 풀로 올린다.
      this.indexQueue = this.indexQueue
        .then(() => this.indexer.indexFile(file))
        .catch((error) => {
          console.error(`인덱스 갱신 실패: ${file.path}`, error);
        });
    }, INDEX_DEBOUNCE_MS);
    this.indexDebounceTimers.set(file.path, timer);
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

  // ============================================
  // Second Brain Layer 와이어링 헬퍼 (Req 12.3)
  // ============================================

  /**
   * Second Brain 실행 컨텍스트를 구성한다 (Req 11.6).
   *
   * - `settings`는 `this.settings.secondBrain`의 **동일 참조**를 넘긴다(복사본 아님).
   *   스케줄러가 `ctx.settings.lastScheduledRun = now`로 갱신한 값이 플러그인 설정에 반영된다.
   * - `aiClient`는 백엔드 전환 시 재할당되므로 호출 시점의 현재 클라이언트를 사용한다(지연 구성).
   * - `persist`는 기존 저장 경로(`saveSettings`)를 재사용한다.
   */
  buildSecondBrainContext(): SecondBrainContext {
    return {
      app: this.app,
      indexer: this.indexer,
      aiClient: this.aiClient,
      settings: this.settings.secondBrain,
      wikiFolder: this.settings.secondBrain.wikiFolder,
      persist: () => this.saveSettings(),
    };
  }

  /** 현재 활성 노트의 제목(basename)을 반환한다. 없으면 빈 문자열. */
  private getActiveNoteTitle(): string {
    return this.app.workspace.getActiveFile()?.basename ?? "";
  }

  /** 현재 에디터의 선택 텍스트를 반환한다. 선택이 없으면 빈 문자열. */
  private getEditorSelection(): string {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) return "";
    return view.editor.getSelection() ?? "";
  }

  /**
   * 채팅 도구와 동일한 핸들러(ToolExecutor.execute)로 second-brain 도구를 실행하고
   * 결과를 Notice로 표시한다(명령 팔레트 경로 공용, DRY). 결과 문자열은 콘솔에도 남겨
   * 긴 LLM 응답(challenge/connect 등)을 확인할 수 있게 한다.
   */
  private async runSecondBrainTool(
    toolName: string,
    input: Record<string, unknown>,
  ): Promise<void> {
    try {
      const result = await this.toolExecutor.execute(toolName, input);
      // 긴 응답도 잘리지 않도록 콘솔에 전체를 남기고, Notice는 10초간 표시한다.
      console.info(`[SecondBrain:${toolName}] ${result}`);
      new Notice(result, 10000);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      new Notice(`Second Brain 도구 실행 실패 (${toolName}): ${reason}`, 10000);
    }
  }

  /**
   * 모든 Second Brain 능동 동작을 명령 팔레트에 등록한다 (Req 12.3).
   *
   * 입력이 필요한 도구는 SecondBrainInputModal로 값을 수집한 뒤 runSecondBrainTool로
   * 채팅과 동일한 핸들러를 호출한다. update_index와 스케줄러 실행은 입력이 없으므로 즉시 실행한다.
   */
  private registerSecondBrainCommands(): void {
    // create_wiki_note — 위키 노트 생성 (제목 + 본문). 활성 노트 제목/선택 텍스트를 프리필.
    this.addCommand({
      id: "second-brain-create-wiki-note",
      name: "위키 노트 생성",
      callback: () => {
        new SecondBrainInputModal(this.app, {
          title: "위키 노트 생성",
          submitLabel: "생성",
          fields: [
            {
              key: "title",
              label: "제목",
              type: "text",
              placeholder: "노트 제목",
              defaultValue: this.getActiveNoteTitle(),
            },
            {
              key: "body",
              label: "본문",
              type: "textarea",
              placeholder: "노트 본문",
              defaultValue: this.getEditorSelection(),
            },
          ],
          onSubmit: (values) =>
            this.runSecondBrainTool("create_wiki_note", {
              title: values.title,
              body: values.body,
            }),
        }).open();
      },
    });

    // update_index — 위키 인덱스 카탈로그 갱신 (입력 불필요, 즉시 실행).
    this.addCommand({
      id: "second-brain-update-index",
      name: "위키 인덱스 갱신",
      callback: () => this.runSecondBrainTool("update_index", {}),
    });

    // synthesize_topic — 주제 종합. 활성 노트 제목을 기본값으로.
    this.addCommand({
      id: "second-brain-synthesize",
      name: "주제 종합 (synthesize)",
      callback: () => {
        new SecondBrainInputModal(this.app, {
          title: "주제 종합 (synthesize)",
          submitLabel: "종합",
          fields: [
            {
              key: "topic",
              label: "주제",
              type: "text",
              placeholder: "종합할 주제/태그",
              defaultValue: this.getActiveNoteTitle(),
            },
          ],
          onSubmit: (values) =>
            this.runSecondBrainTool("synthesize_topic", { topic: values.topic }),
        }).open();
      },
    });

    // reconcile_topic — 모순 점검(비파괴). 활성 노트 제목을 기본값으로.
    this.addCommand({
      id: "second-brain-reconcile",
      name: "모순 점검 (reconcile)",
      callback: () => {
        new SecondBrainInputModal(this.app, {
          title: "모순 점검 (reconcile)",
          submitLabel: "점검",
          fields: [
            {
              key: "topic",
              label: "주제",
              type: "text",
              placeholder: "모순을 점검할 주제",
              defaultValue: this.getActiveNoteTitle(),
            },
          ],
          onSubmit: (values) =>
            this.runSecondBrainTool("reconcile_topic", { topic: values.topic }),
        }).open();
      },
    });

    // challenge — 주장 반박. 에디터 선택 텍스트를 기본값으로.
    this.addCommand({
      id: "second-brain-challenge",
      name: "주장 반박 (challenge)",
      callback: () => {
        new SecondBrainInputModal(this.app, {
          title: "주장 반박 (challenge)",
          submitLabel: "반박",
          fields: [
            {
              key: "claim",
              label: "주장",
              type: "textarea",
              placeholder: "검토(반박)할 주장",
              defaultValue: this.getEditorSelection(),
            },
          ],
          onSubmit: (values) =>
            this.runSecondBrainTool("challenge", { claim: values.claim }),
        }).open();
      },
    });

    // connect — 두 주제 연결 (topicA, topicB).
    this.addCommand({
      id: "second-brain-connect",
      name: "두 주제 연결 (connect)",
      callback: () => {
        new SecondBrainInputModal(this.app, {
          title: "두 주제 연결 (connect)",
          submitLabel: "연결",
          fields: [
            { key: "topicA", label: "주제 A", type: "text", placeholder: "첫 번째 주제" },
            { key: "topicB", label: "주제 B", type: "text", placeholder: "두 번째 주제" },
          ],
          onSubmit: (values) =>
            this.runSecondBrainTool("connect", {
              topicA: values.topicA,
              topicB: values.topicB,
            }),
        }).open();
      },
    });

    // emerge — 최근 N일 패턴 발견 (days, 기본 7).
    this.addCommand({
      id: "second-brain-emerge",
      name: "최근 패턴 발견 (emerge)",
      callback: () => {
        new SecondBrainInputModal(this.app, {
          title: "최근 패턴 발견 (emerge)",
          submitLabel: "발견",
          fields: [
            {
              key: "days",
              label: "최근 일수",
              type: "number",
              placeholder: "7",
              defaultValue: "7",
            },
          ],
          onSubmit: (values) => {
            // 숫자 변환 — 비숫자/빈값은 핸들러(selectRecentNotes)가 보정하도록 기본 7로 둔다.
            const parsed = Number(values.days);
            const days = Number.isFinite(parsed) ? parsed : 7;
            return this.runSecondBrainTool("emerge", { days });
          },
        }).open();
      },
    });

    // architect — 코드베이스 아키텍트. 경로 입력(미입력 시 볼트 전체).
    this.addCommand({
      id: "second-brain-architect",
      name: "코드베이스 아키텍트 (architect)",
      callback: () => {
        new SecondBrainInputModal(this.app, {
          title: "코드베이스 아키텍트 (architect)",
          submitLabel: "분석",
          fields: [
            {
              key: "path",
              label: "스캔 경로 (비우면 볼트 전체)",
              type: "text",
              placeholder: "예: src",
            },
          ],
          onSubmit: (values) => {
            // 경로가 비어 있으면 path를 생략하여 볼트 전체를 대상으로 한다.
            const path = values.path.trim();
            const input: Record<string, unknown> = path ? { path } : {};
            return this.runSecondBrainTool("architect", input);
          },
        }).open();
      },
    });

    // 스케줄러 수동 실행 — 비파괴 Cleanup_Pipeline을 즉시 실행 (Req 11.1).
    // 옵트인 격리: enabled=false면 runCleanupPipeline은 단계 내부에서 쓰기를 수행하지 않는다.
    // (자동 트리거와 달리 수동 실행은 schedulerEnabled와 무관하게 사용자 명시 요청으로 동작)
    this.addCommand({
      id: "second-brain-run-scheduler",
      name: "Second Brain 정리 실행 (스케줄러)",
      callback: async () => {
        if (!this.settings.secondBrain.enabled) {
          new Notice("Second Brain 기능이 비활성화되어 있습니다. 설정에서 활성화한 뒤 다시 시도해 주세요.");
          return;
        }
        try {
          // 실행 결과를 그대로 보고한다. 과거에는 모든 단계가 실패해도 성공 Notice를
          // 띄워 사용자가 실패를 알 수 없었다.
          const result = await this.secondBrainScheduler.runCleanupPipeline(
            this.buildSecondBrainContext(),
            Date.now(),
          );
          if (!result.ran) {
            new Notice("Second Brain 정리가 이미 진행 중입니다.");
          } else if (result.failed === 0) {
            new Notice("Second Brain 정리(catalog 갱신)를 실행했습니다.");
          } else if (result.succeeded === 0) {
            new Notice(
              `Second Brain 정리 실패: 모든 단계가 실패했습니다 (${result.failedSteps.join(", ")}). 콘솔 로그를 확인해 주세요.`
            );
          } else {
            new Notice(
              `Second Brain 정리 일부 실패: ${result.succeeded}개 성공, ${result.failed}개 실패 (${result.failedSteps.join(", ")}).`
            );
          }
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          new Notice(`Second Brain 정리 실행 실패: ${reason}`);
        }
      },
    });
  }

  // 설정 로드/저장
  async loadSettings(): Promise<void> {
    // 저장된 원본 데이터를 먼저 로드한다 (DEFAULT_SETTINGS 병합 전)
    const loaded = (await this.loadData()) as Record<string, unknown> | null;
    // 마이그레이션: 저장 데이터에 plannerFolder 키가 없고 todoFolder가 비어있지 않으면
    // todoFolder 값을 plannerFolder로 승계한다. (병합 전 원본에 적용해야 키 존재 여부 판별 가능)
    const migrated = migratePlannerSettings(loaded ?? {});
    const raw = Object.assign({}, DEFAULT_SETTINGS, migrated);

    // 마이그레이션: 시스템 프롬프트는 이제 내장 기본 프롬프트(BASE_SYSTEM_PROMPT)를 항상 사용하고,
    // 설정의 systemPrompt는 "추가 지침"으로만 동작한다. 기존 사용자가 과거 기본 프롬프트를
    // 그대로 저장해 둔 경우(직접 커스터마이징한 적 없음) 빈 문자열로 초기화하여 중복을 방지한다.
    if (
      typeof raw.systemPrompt === "string" &&
      LEGACY_DEFAULT_SYSTEM_PROMPTS.includes(raw.systemPrompt.trim())
    ) {
      raw.systemPrompt = "";
    }

    // 마이그레이션: data.json에 암호화된 키가 남아있으면 로컬로 이전 후 제거
    let hasMigratedKeys = false;
    for (const field of SENSITIVE_FIELDS) {
      const val = (raw as Record<string, unknown>)[field];
      if (typeof val === "string" && val.length > 0) {
        hasMigratedKeys = true;
        break;
      }
    }

    // 마이그레이션: temperature → effort. 구버전 설정에는 effort 키가 없고 대신
    // temperature(0.0~1.0)가 저장돼 있으므로, 그 값의 크기를 강도로 환산해 승계한다.
    // (temperature는 더 이상 어떤 공급자에도 전송하지 않는다.)
    // 아래 hasMigratedKeys 분기가 saveData를 호출하므로, 그 전에 raw에 반영해야
    // 변환 결과가 저장된다. 나중에 반영하면 기본값 "medium"이 저장돼 다음 실행에서
    // effort 키가 존재한다는 이유로 마이그레이션이 건너뛰어진다.
    if (typeof loaded?.effort !== "string") {
      const legacyTemp = loaded?.temperature;
      raw.effort =
        typeof legacyTemp === "number" && Number.isFinite(legacyTemp)
          ? legacyTemperatureToEffort(legacyTemp)
          : DEFAULT_SETTINGS.effort;
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

    // 마이그레이션: 임베딩 모델이 빈 문자열이면 기본값으로 복원
    // (이전 버전에서 빈 문자열로 저장된 경우 대응)
    if (!this.settings.embeddingModel) {
      this.settings.embeddingModel = DEFAULT_SETTINGS.embeddingModel;
    }
    if (!this.settings.bedrockEmbeddingModel) {
      this.settings.bedrockEmbeddingModel = DEFAULT_SETTINGS.bedrockEmbeddingModel;
    }

    // 저장된 effort가 현재 백엔드·모델의 허용 집합을 벗어나면 근접 값으로 보정한다.
    this.settings.effort = clampEffort(
      this.settings.aiBackend,
      activeChatModelId(this.settings),
      this.settings.effort
    );

    // Second Brain 설정 정규화 (Req 1.3): this.settings가 두 hasMigratedKeys 분기로
    // 확정된 뒤에 적용해야 한다(병합 직후에는 이후 분기에서 통째로 덮어써짐).
    // 정규화 입력은 사용자 저장 원본(loaded?.secondBrain)을 직접 사용한다.
    // 누락/부분/이상 값은 normalize가 기본값으로 채워 비파괴 마이그레이션을 보장한다.
    this.settings.secondBrain = normalizeSecondBrainSettings(loaded?.secondBrain);

    // 로드 시점 스코프를 기준선으로 기록한다(첫 저장에서 불필요한 캐시 무효화 방지).
    this.lastAccountScope = this.accountScopeKey();
  }

  async saveSettings(): Promise<void> {
    // 민감 필드는 로컬 전용 파일에 암호화하여 저장 (iCloud 동기화 안 됨)
    saveCredentialsToLocal(this.settings as unknown as Record<string, unknown>);
    // data.json에는 민감 필드를 제거하여 저장 (iCloud 동기화 대상)
    const stripped = stripSensitiveFields(this.settings);
    await this.saveData(stripped);
    this.aiClient?.updateSettings(this.settings);

    // 설정 UI는 this.settings를 먼저 바꾼 뒤 saveSettings를 호출하므로, 이 함수
    // 내부에서 전/후를 비교하면 항상 같다. 마지막으로 관측한 스코프를 필드에 보관해
    // 그것과 비교해야 실제 변경을 감지할 수 있다.
    const scope = this.accountScopeKey();
    if (this.lastAccountScope !== scope) {
      this.lastAccountScope = scope;
      this.refreshChatModelLists();
    }
    // 브랜딩을 현재 백엔드에 맞게 갱신
    updateBranding(this.settings.aiBackend);
    // 설정 변경이 Graph RAG 검색에도 즉시 반영되도록 인덱서 옵션을 재적용한다 (견고성 목적)
    this.applySearchOptions();
  }

  /**
   * 접근 가능한 모델 집합을 좌우하는 설정들의 시그니처.
   * 백엔드·인증 방식·자격증명 주체·엔드포인트·리전이 바뀌면 이 값이 달라진다.
   * 비밀값은 원문 대신 길이와 간단한 체크섬으로 요약해, 같은 접두사를 가진 키로
   * 교체하는 경우까지 감지하면서도 평문을 메모리에 중복 보관하지 않는다.
   */
  private accountScopeKey(): string {
    const s = this.settings;
    switch (s.aiBackend) {
      case "bedrock": {
        const subject =
          s.awsAuthMethod === "profile"
            ? s.awsProfile
            : s.awsAuthMethod === "apiKey"
              ? digestSecret(s.bedrockApiKey)
              : s.awsAccessKeyId;
        return `bedrock:${s.awsAuthMethod}:${subject}:${s.awsRegion}`;
      }
      case "openai":
        return `openai:${digestSecret(s.openaiApiKey)}:${s.openaiBaseUrl}`;
      case "ollama":
        return `ollama:${s.ollamaBaseUrl}`;
      case "gemini":
      default:
        return `gemini:${digestSecret(s.geminiApiKey)}`;
    }
  }

  /** 열려 있는 채팅 뷰의 모델 목록 캐시를 비워 다음 조회에서 재로드하게 한다 */
  private refreshChatModelLists(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      (leaf.view as { refreshModelList?: () => void }).refreshModelList?.();
    }
  }

  /** 현재 설정의 Graph RAG 검색 옵션을 인덱서에 적용한다 (로드/저장 시 공통 사용) */
  private applySearchOptions(): void {
    this.indexer?.setSearchOptions({
      depth: this.settings.graphTraversalDepth,
      chunkMaxSize: this.settings.chunkMaxSize,
      chunkOverlap: this.settings.chunkOverlap,
    });
    // 임베딩 구성 시그니처를 주입한다. 인덱스 저장 시 함께 기록되고, 로드 시
    // 비교되어 임베딩 모델 변경(벡터 공간 변경)을 감지한다.
    this.indexer?.setEmbeddingSignature(embeddingSignature(this.settings));
  }

  /** 백엔드 전환 시 기존 클라이언트를 폐기하고 새 클라이언트를 생성한다 */
  recreateAiClient(): void {
    this.aiClient = createAiClient(this.settings);
    // 인덱서의 AI 클라이언트 참조도 갱신
    this.indexer.client = this.aiClient;
  }

  /** 4개 백엔드의 커스텀 아이콘을 모두 등록한다 (전환 시 즉시 사용 가능) */
  private registerBrandingIcons(): void {
    // bedrock/gemini/openai/ollama 4개 백엔드 아이콘을 모두 addIcon으로 등록한다.
    // (하나라도 누락되면 해당 백엔드로 전환 시 아이콘이 표시되지 않는다)
    const backends: GeminiAssistantSettings["aiBackend"][] = [
      "bedrock",
      "gemini",
      "openai",
      "ollama",
    ];
    for (const backend of backends) {
      const { icon } = getBranding(backend);
      if (icon.svg) addIcon(icon.id, icon.svg);
    }
  }

  /** 백엔드 전환 후 리본 아이콘, 뷰 탭/헤더 등 UI 브랜딩을 갱신한다 */
  refreshBranding(): void {
    // 리본 아이콘 갱신
    if (this.ribbonIconEl) {
      this.ribbonIconEl.empty();
      setIcon(this.ribbonIconEl, BRANDING.icon.id);
      this.ribbonIconEl.setAttribute("aria-label", BRANDING.displayName);
    }
    // 열려있는 뷰의 헤더(타이틀 아이콘/이름)를 다시 렌더하고 탭 아이콘을 갱신한다.
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE);
    for (const leaf of leaves) {
      // 뷰 내부 헤더(ba-title-icon 등)는 rebuildUI(=onOpen 재실행)로 새 BRANDING을 반영한다.
      (leaf.view as any).rebuildUI?.();
      // 탭 헤더 아이콘/타이틀(getIcon/getDisplayText)도 갱신 시도 (미지원 시 no-op)
      (leaf as any).updateHeader?.();
    }
  }

  // 인덱스 로드/저장
  async loadIndex(): Promise<void> {
    try {
      // 숨김 파일(.으로 시작)은 Vault API 캐시에 포함되지 않으므로 adapter를 직접 사용
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
      // 숨김 파일(.으로 시작)은 Vault API 캐시에 포함되지 않으므로 adapter를 직접 사용
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

  // 옵시디언 app.metadataCache를 감싸는 MetadataSource 어댑터를 생성한다.
  // GraphExtractor가 옵시디언 API에 직접 의존하지 않도록 추상화 계층을 제공한다.
  private createMetadataSource(): MetadataSource {
    const app = this.app;
    return {
      // 해석된 아웃링크 맵: app.metadataCache.resolvedLinks를 그대로 노출
      get resolvedLinks(): Record<string, Record<string, number>> {
        return app.metadataCache.resolvedLinks;
      },
      // 백링크: 비공식 getBacklinksForFile() 대신 resolvedLinks 역산으로 구현 (타입 안정성 우선)
      // 다른 노트(source)의 아웃링크 맵에 path가 키로 존재하면 그 source를 백링크로 간주
      getBacklinks: (path: string): string[] => {
        const resolved = app.metadataCache.resolvedLinks;
        const seen = new Set<string>();
        for (const sourcePath of Object.keys(resolved)) {
          // 자기 자신은 백링크에서 제외
          if (sourcePath === path) continue;
          const linkMap = resolved[sourcePath];
          if (linkMap && Object.prototype.hasOwnProperty.call(linkMap, path)) {
            seen.add(sourcePath);
          }
        }
        return Array.from(seen);
      },
      // 노트 캐시 조회: 인라인+프론트매터 태그 통합(getAllTags)과 frontmatter, frontmatterEndOffset 노출
      getFileCache: (path: string) => {
        const file = app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) return null;
        const cache = app.metadataCache.getFileCache(file);
        if (!cache) return null;
        // getAllTags는 인라인 태그와 프론트매터 태그를 '#' 접두사 포함 형태로 통합 반환한다
        // ('#' 제거는 extractMetadata 내부 stripTagHash가 담당)
        const tags = getAllTags(cache) ?? undefined;
        return {
          tags: tags ?? undefined,
          frontmatter: cache.frontmatter as Record<string, unknown> | undefined,
          // frontmatter 끝 오프셋(본문 분리용). 캐시에 위치 정보가 없으면 undefined
          frontmatterEndOffset: cache.frontmatterPosition?.end?.offset,
        };
      },
      // dangling 판정: 해당 경로의 노트가 볼트에 실제 존재하는지 여부
      fileExists: (path: string): boolean => {
        return app.vault.getAbstractFileByPath(path) instanceof TFile;
      },
    };
  }

  // Obsidian Vault API를 FileAdapter 인터페이스로 감싸는 어댑터 생성
  private createVaultFileAdapter(): FileAdapter {
    const vault = this.app.vault;
    return {
      exists: async (path: string): Promise<boolean> => {
        // 숨김 파일(.으로 시작)은 Vault API 캐시에 포함되지 않으므로 adapter를 직접 사용
        return await vault.adapter.exists(path);
      },
      read: async (path: string): Promise<string> => {
        // 숨김 파일(.으로 시작)은 Vault API 캐시에 포함되지 않으므로 adapter를 직접 사용
        return await vault.adapter.read(path);
      },
      write: async (path: string, data: string): Promise<void> => {
        const file = vault.getAbstractFileByPath(path);
        if (file && file instanceof TFile) {
          await vault.modify(file, data);
        } else {
          // 캐시에 없지만 파일은 존재할 수 있으므로 adapter로 직접 쓰기 (숨김 파일 대응)
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
            // 캐시에 없지만 파일은 존재하는 경우 adapter로 직접 쓰기 (숨김 파일 대응)
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
      // MCP 설정 파일은 .obsidian 하위 플러그인 폴더에 위치하므로 adapter를 직접 사용
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
      // MCP 설정 파일은 .obsidian 하위 플러그인 폴더에 위치하므로 adapter를 직접 사용
      await this.app.vault.adapter.write(configPath, configJson);
    } catch (error) {
      console.error("MCP 설정 저장 실패:", error);
    }
  }

  // MCP 설정 읽기
  async readMcpConfig(): Promise<string> {
    const configPath = this.getMcpConfigPath();
    try {
      // MCP 설정 파일은 .obsidian 하위 플러그인 폴더에 위치하므로 adapter를 직접 사용
      const adapter = this.app.vault.adapter;
      if (await adapter.exists(configPath)) {
        return await adapter.read(configPath);
      }
    } catch {
      // 파일 없으면 기본값
    }
    return JSON.stringify(DEFAULT_MCP_CONFIG, null, 2);
  }


}
