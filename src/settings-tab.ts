import { App, FuzzySuggestModal, Modal, Notice, PluginSettingTab, Setting, TFolder, setIcon } from "obsidian";
import type BedrockAssistantPlugin from "./main";
import { SKILLS } from "./skills";
import { BRANDING } from "./branding";

// 설정 탭 다국어 레이블
const I18N = {
  en: {
    title: BRANDING.settingsTitle.en,
    pluginDesc: "An AI assistant sidebar for Obsidian powered by AWS Bedrock. Chat with Claude models, search your vault with embeddings, auto-generate tags, manage to-dos, and use MCP tools — all from within Obsidian.",
    sponsorLabel: "If you find this plugin useful, consider supporting its development.",
    language: "Language",
    languageDesc: "UI language for settings",
    awsAuth: "AWS Authentication",
    awsRegion: "AWS Region",
    awsRegionDesc: "AWS region for Bedrock",
    credSource: "Credential Source",
    credSourceDesc: "manual: enter keys directly (stored in plaintext), env: use environment variables/AWS profile (recommended)",
    credManual: "Manual",
    credEnv: "Env / Profile",
    credApiKey: "Bedrock API Key",
    accessKey: "AWS Access Key ID",
    accessKeyDesc: "IAM user Access Key ID",
    secretKey: "AWS Secret Access Key",
    secretKeyDesc: "IAM user Secret Access Key",
    secretKeyPlaceholder: "Enter secret key",
    apiKey: "Bedrock API Key",
    apiKeyDesc: "Bedrock API Key (Bearer token authentication)",
    apiKeyPlaceholder: "Enter API key",
    awsProfile: "AWS Profile",
    awsProfileDesc: "Profile from ~/.aws/credentials (leave empty for default chain)",
    modelSettings: "Model Settings",
    chatModel: "Chat Model",
    chatModelDesc: "Bedrock Claude model ID",
    embeddingModel: "Embedding Model",
    embeddingModelDesc: "Bedrock embedding model ID",
    genSettings: "Generation Settings",
    maxTokens: "Max Tokens",
    maxTokensDesc: "Maximum response tokens",
    temperature: "Temperature",
    temperatureDesc: "Response creativity (0.0 ~ 1.0)",
    systemPrompt: "System Prompt",
    systemPromptDesc: "Defines the AI assistant's default behavior",
    systemPromptPlaceholder: "Enter system prompt...",
    ux: "User Experience",
    greeting: "Welcome Greeting",
    greetingDesc: "Greeting shown when opening the sidebar",
    autoAttach: "Auto-attach Active Note",
    autoAttachDesc: "Automatically include the currently open note as context",
    persistChat: "Save Chat History",
    persistChatDesc: "Preserve conversation after plugin restart",
    clearHistory: "Clear All History",
    clearHistoryDesc: "Delete all saved chat sessions",
    clearHistoryBtn: "Clear History",
    clearHistoryConfirm: "All chat history has been cleared.",
    templateFolder: "Template Folder",
    templateFolderDesc: "Vault folder path for storing templates",
    chatFontSize: "Chat Font Size",
    chatFontSizeDesc: "Font size for the chat area (px)",
    codeBlock: "Code Block",
    codeBlockDesc: "When the AI writes code blocks with a language specified (e.g. ```python), the Code Styler plugin automatically applies syntax highlighting, headers, and icons.",
    codeStylerInstall: "Install Code Styler",
    codeStylerInfo: "Install the Code Styler plugin to enhance code block rendering with language-specific styling.",
    todo: "To-Do",
    todoFolder: "To-Do Folder",
    todoFolderDesc: "Vault folder path for storing to-do lists",
    todoTasksInstall: "Install Tasks Plugin",
    todoTasksInfo: "Install the Tasks plugin to enable advanced task management with due dates, recurring tasks, and queries.",
    todoTemplate: "To-Do Template",
    todoTemplateDesc: "Template file name in the Templates folder (without .md). Variables: {{date}}, {{prevDate}}.",
    todoTemplatePlaceholder: "Daily To-Do",
    todoArchiveFolder: "Archive Folder",
    todoArchiveFolderDesc: "Folder to move old to-do files into",
    todoArchiveDays: "Archive After (days)",
    todoArchiveDaysDesc: "Move to-do files older than this many days to the archive folder",
    skills: "Obsidian Skills",
    skillsDesc: "Enabled skills add Obsidian knowledge to the system prompt for accurate syntax usage.",
    mcpServers: "MCP Servers",
    mcpNoServers: "No MCP servers configured.",
    mcpManage: "Manage MCP Servers",
    mcpManageDesc: "Edit MCP server configuration and manage connections",
    mcpEdit: "Edit Config",
    mcpStopAll: "Stop All",
    mcpStopped: "All MCP server connections terminated.",
    mcpModalTitle: "MCP Server Settings",
    mcpModalTools: (name: string, count: number) => `${name} — ${count} tools`,
    mcpModalDesc: "Edit MCP server configuration in JSON format.",
    mcpModalSave: "Save & Connect",
    mcpModalCancel: "Close",
    mcpModalJsonError: "❌ Invalid JSON format.",
    mcpModalSaving: "MCP config saved. Connecting...",
    mcpModalConnected: (names: string) => `✅ MCP connected: ${names}`,
    mcpModalFailed: (names: string) => `❌ MCP failed: ${names}`,
    mcpModalNoServers: "No MCP servers configured.",
    mcpStatusTitle: "Connection Status",
    mcpStatusDisconnected: (name: string) => `${name} — disconnected`,
    mcpStatusNone: "No servers connected.",
    folderSelectPlaceholder: "Select a folder...",
    confirmToolExecution: "Confirm Destructive Tools",
    confirmToolExecutionDesc: "Show a confirmation dialog before executing destructive tools (edit, delete, move, create)",
    mcpTimeout: "MCP Tool Timeout",
    mcpTimeoutDesc: "Timeout in seconds for MCP tool requests (10–120)",
  },
  ko: {
    title: BRANDING.settingsTitle.ko,
    pluginDesc: "AWS Bedrock 기반 Obsidian AI 어시스턴트 사이드바입니다. Claude 모델과 대화하고, 임베딩으로 볼트를 검색하고, 태그 자동 생성, To-Do 관리, MCP 도구 연동까지 — 모두 Obsidian 안에서 가능합니다.",
    sponsorLabel: "이 플러그인이 유용하다면 개발을 후원해 주세요.",
    language: "언어",
    languageDesc: "설정 UI 언어",
    awsAuth: "AWS 인증",
    awsRegion: "AWS 리전",
    awsRegionDesc: "Bedrock을 사용할 AWS 리전",
    credSource: "자격증명 소스",
    credSourceDesc: "manual: 키 직접 입력 (설정 파일에 평문 저장됨), env: 환경변수/AWS 프로파일 사용 (권장)",
    credManual: "직접 입력 (Manual)",
    credEnv: "환경변수/프로파일 (Env)",
    credApiKey: "Bedrock API Key",
    accessKey: "AWS Access Key ID",
    accessKeyDesc: "IAM 사용자의 Access Key ID",
    secretKey: "AWS Secret Access Key",
    secretKeyDesc: "IAM 사용자의 Secret Access Key",
    secretKeyPlaceholder: "시크릿 키 입력",
    apiKey: "Bedrock API Key",
    apiKeyDesc: "Bedrock API Key (Bearer 토큰 인증)",
    apiKeyPlaceholder: "API 키 입력",
    awsProfile: "AWS 프로파일",
    awsProfileDesc: "~/.aws/credentials 에서 사용할 프로파일 (비워두면 기본 체인 사용)",
    modelSettings: "모델 설정",
    chatModel: "채팅 모델",
    chatModelDesc: "Bedrock Claude 모델 ID",
    embeddingModel: "임베딩 모델",
    embeddingModelDesc: "Bedrock 임베딩 모델 ID",
    genSettings: "생성 설정",
    maxTokens: "최대 토큰",
    maxTokensDesc: "응답 최대 토큰 수",
    temperature: "Temperature",
    temperatureDesc: "응답 창의성 (0.0 ~ 1.0)",
    systemPrompt: "시스템 프롬프트",
    systemPromptDesc: "AI 어시스턴트의 기본 동작을 정의하는 프롬프트",
    systemPromptPlaceholder: "시스템 프롬프트를 입력하세요...",
    ux: "사용자 경험",
    greeting: "환영 인사",
    greetingDesc: "사이드바를 열 때 표시되는 인사말",
    autoAttach: "현재 노트 자동 첨부",
    autoAttachDesc: "메시지 전송 시 현재 열려있는 노트를 자동으로 컨텍스트에 포함합니다",
    persistChat: "대화 히스토리 저장",
    persistChatDesc: "플러그인 재시작 후에도 대화 내용을 유지합니다",
    clearHistory: "히스토리 비우기",
    clearHistoryDesc: "저장된 모든 대화 세션을 삭제합니다",
    clearHistoryBtn: "히스토리 비우기",
    clearHistoryConfirm: "모든 대화 히스토리가 삭제되었습니다.",
    templateFolder: "템플릿 폴더",
    templateFolderDesc: "템플릿을 저장할 볼트 내 폴더 경로",
    chatFontSize: "채팅 폰트 크기",
    chatFontSizeDesc: "채팅 영역의 글자 크기 (px)",
    codeBlock: "코드 블록",
    codeBlockDesc: "AI가 코드 블록에 언어를 명시하면 (예: ```python) Code Styler 플러그인이 자동으로 구문 강조, 헤더, 아이콘 등을 적용합니다.",
    codeStylerInstall: "Code Styler 설치",
    codeStylerInfo: "Code Styler 플러그인을 설치하면 코드 블록이 언어별 스타일로 더 보기 좋게 렌더링됩니다.",
    todo: "To-Do",
    todoFolder: "To-Do 폴더",
    todoFolderDesc: "To-Do 리스트를 저장할 볼트 내 폴더 경로",
    todoTasksInstall: "Tasks 플러그인 설치",
    todoTasksInfo: "Tasks 플러그인을 설치하면 마감일, 반복 작업, 쿼리 등 고급 할 일 관리 기능을 사용할 수 있습니다.",
    todoTemplate: "To-Do 템플릿",
    todoTemplateDesc: "템플릿 폴더 내 파일명 (.md 제외). 사용 가능 변수: {{date}}, {{prevDate}}.",
    todoTemplatePlaceholder: "Daily To-Do",
    todoArchiveFolder: "아카이브 폴더",
    todoArchiveFolderDesc: "오래된 To-Do 파일을 이동할 폴더",
    todoArchiveDays: "아카이브 기준 (일)",
    todoArchiveDaysDesc: "이 일수를 초과한 To-Do 파일을 아카이브 폴더로 이동합니다",
    skills: "Obsidian 스킬",
    skillsDesc: "활성화된 스킬의 지식이 시스템 프롬프트에 추가되어 AI가 Obsidian 문법을 정확하게 사용합니다.",
    mcpServers: "MCP 서버",
    mcpNoServers: "설정된 MCP 서버가 없습니다.",
    mcpManage: "MCP 서버 관리",
    mcpManageDesc: "MCP 서버 설정을 편집하고 연결을 관리합니다",
    mcpEdit: "설정 편집",
    mcpStopAll: "모두 종료",
    mcpStopped: "모든 MCP 서버 연결이 종료되었습니다.",
    mcpModalTitle: "MCP 서버 설정",
    mcpModalTools: (name: string, count: number) => `${name} — 도구 ${count}개`,
    mcpModalDesc: "MCP 서버 설정을 JSON 형식으로 편집하세요.",
    mcpModalSave: "저장 및 연결",
    mcpModalCancel: "닫기",
    mcpModalJsonError: "❌ JSON 형식이 올바르지 않습니다.",
    mcpModalSaving: "MCP 설정 저장됨. 서버 연결 중...",
    mcpModalConnected: (names: string) => `✅ MCP 서버 연결: ${names}`,
    mcpModalFailed: (names: string) => `❌ MCP 서버 실패: ${names}`,
    mcpModalNoServers: "설정된 MCP 서버가 없습니다.",
    mcpStatusTitle: "연결 상태",
    mcpStatusDisconnected: (name: string) => `${name} — 연결 끊김`,
    mcpStatusNone: "연결된 서버가 없습니다.",
    folderSelectPlaceholder: "폴더를 선택하세요...",
    confirmToolExecution: "파괴적 도구 실행 확인",
    confirmToolExecutionDesc: "파괴적 도구(편집, 삭제, 이동, 생성) 실행 전 확인 대화상자를 표시합니다",
    mcpTimeout: "MCP 도구 타임아웃",
    mcpTimeoutDesc: "MCP 도구 요청 타임아웃 (10~120초)",
  },
} as const;

// 설정 탭
export class BedrockSettingTab extends PluginSettingTab {
  plugin: BedrockAssistantPlugin;

  constructor(app: App, plugin: BedrockAssistantPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    const t = I18N[this.plugin.settings.language] || I18N.en;

    containerEl.createEl("h2", { text: t.title });

    // 플러그인 설명 + 후원 배너 (하나의 박스)
    const aboutBox = containerEl.createDiv({ cls: "ba-about-box" });
    aboutBox.createEl("p", { text: t.pluginDesc, cls: "ba-about-desc" });
    const sponsorRow = aboutBox.createDiv({ cls: "ba-about-sponsor" });
    sponsorRow.createSpan({ text: t.sponsorLabel });
    const sponsorLink = sponsorRow.createEl("a", {
      href: "https://buymeacoffee.com/teinam",
    });
    sponsorLink.setAttr("target", "_blank");
    sponsorLink.createEl("img", {
      attr: {
        src: "https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png",
        alt: "Buy Me A Coffee",
        height: "36",
      },
      cls: "ba-sponsor-img",
    });

    // 언어 선택
    new Setting(containerEl)
      .setName(t.language)
      .setDesc(t.languageDesc)
      .addDropdown((dropdown) =>
        dropdown
          .addOption("en", "English")
          .addOption("ko", "한국어")
          .setValue(this.plugin.settings.language)
          .onChange(async (value) => {
            this.plugin.settings.language = value as "en" | "ko";
            await this.plugin.saveSettings();
            // 열려있는 채팅 뷰 UI 즉시 재빌드
            const leaves = this.app.workspace.getLeavesOfType(BRANDING.viewType);
            for (const leaf of leaves) {
              (leaf.view as any).rebuildUI?.();
            }
            this.display();
          })
      );

    // AWS 인증 설정
    containerEl.createEl("h3", { text: t.awsAuth });

    new Setting(containerEl)
      .setName(t.awsRegion)
      .setDesc(t.awsRegionDesc)
      .addDropdown((dropdown) => {
        const regions = [
          "us-east-1",
          "us-east-2",
          "us-west-1",
          "us-west-2",
          "ap-south-1",
          "ap-northeast-1",
          "ap-northeast-2",
          "ap-northeast-3",
          "ap-southeast-1",
          "ap-southeast-2",
          "ca-central-1",
          "eu-central-1",
          "eu-west-1",
          "eu-west-2",
          "eu-west-3",
          "eu-north-1",
          "sa-east-1",
        ];
        for (const r of regions) {
          dropdown.addOption(r, r);
        }
        // 현재 값이 목록에 없으면 추가
        if (!regions.includes(this.plugin.settings.awsRegion)) {
          dropdown.addOption(this.plugin.settings.awsRegion, this.plugin.settings.awsRegion);
        }
        dropdown
          .setValue(this.plugin.settings.awsRegion)
          .onChange(async (value) => {
            this.plugin.settings.awsRegion = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName(t.credSource)
      .setDesc(t.credSourceDesc)
      .addDropdown((dropdown) =>
        dropdown
          .addOption("manual", t.credManual)
          .addOption("env", t.credEnv)
          .addOption("apikey", t.credApiKey)
          .setValue(this.plugin.settings.awsCredentialSource)
          .onChange(async (value) => {
            this.plugin.settings.awsCredentialSource = value as "manual" | "env" | "apikey";
            await this.plugin.saveSettings();
            this.display();
          })
      );

    if (this.plugin.settings.awsCredentialSource === "manual") {
      new Setting(containerEl)
        .setName(t.accessKey)
        .setDesc(t.accessKeyDesc)
        .addText((text) =>
          text
            .setPlaceholder("AKIA...")
            .setValue(this.plugin.settings.awsAccessKeyId)
            .onChange(async (value) => {
              this.plugin.settings.awsAccessKeyId = value.trim();
              await this.plugin.saveSettings();
            })
        );

      const secretSetting = new Setting(containerEl)
        .setName(t.secretKey)
        .setDesc(t.secretKeyDesc)
        .addText((text) => {
          text
            .setPlaceholder(t.secretKeyPlaceholder)
            .setValue(this.plugin.settings.awsSecretAccessKey)
            .onChange(async (value) => {
              this.plugin.settings.awsSecretAccessKey = value.trim();
              await this.plugin.saveSettings();
            });
          text.inputEl.type = "password";
          text.inputEl.addClass("ba-secret-input");
        });
      // 눈 버튼 추가
      this.addToggleVisibilityButton(secretSetting.controlEl);
    } else if (this.plugin.settings.awsCredentialSource === "apikey") {
      const apiKeySetting = new Setting(containerEl)
        .setName(t.apiKey)
        .setDesc(t.apiKeyDesc)
        .addText((text) => {
          text
            .setPlaceholder(t.apiKeyPlaceholder)
            .setValue(this.plugin.settings.bedrockApiKey)
            .onChange(async (value) => {
              this.plugin.settings.bedrockApiKey = value.trim();
              await this.plugin.saveSettings();
            });
          text.inputEl.type = "password";
          text.inputEl.addClass("ba-secret-input");
        });
      // 눈 버튼 추가
      this.addToggleVisibilityButton(apiKeySetting.controlEl);
    } else {
      new Setting(containerEl)
        .setName(t.awsProfile)
        .setDesc(t.awsProfileDesc)
        .addText((text) =>
          text
            .setPlaceholder("default")
            .setValue(this.plugin.settings.awsProfile)
            .onChange(async (value) => {
              this.plugin.settings.awsProfile = value.trim();
              await this.plugin.saveSettings();
            })
        );
    }

    // 모델 설정
    containerEl.createEl("h3", { text: t.modelSettings });

    new Setting(containerEl)
      .setName(t.embeddingModel)
      .setDesc(t.embeddingModelDesc)
      .addText((text) =>
        text
          .setPlaceholder("amazon.titan-embed-text-v2:0")
          .setValue(this.plugin.settings.embeddingModel)
          .onChange(async (value) => {
            this.plugin.settings.embeddingModel = value;
            await this.plugin.saveSettings();
          })
      );

    // 생성 설정
    containerEl.createEl("h3", { text: t.genSettings });

    new Setting(containerEl)
      .setName(t.maxTokens)
      .setDesc(t.maxTokensDesc)
      .addText((text) =>
        text
          .setPlaceholder("4096")
          .setValue(String(this.plugin.settings.maxTokens))
          .onChange(async (value) => {
            const num = parseInt(value);
            if (!isNaN(num) && num > 0) {
              this.plugin.settings.maxTokens = num;
              await this.plugin.saveSettings();
            }
          })
      );

    new Setting(containerEl)
      .setName(t.temperature)
      .setDesc(t.temperatureDesc)
      .addSlider((slider) =>
        slider
          .setLimits(0, 1, 0.1)
          .setValue(this.plugin.settings.temperature)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.temperature = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(t.systemPrompt)
      .setDesc(t.systemPromptDesc)
      .addTextArea((text) => {
        text
          .setPlaceholder(t.systemPromptPlaceholder)
          .setValue(this.plugin.settings.systemPrompt)
          .onChange(async (value) => {
            this.plugin.settings.systemPrompt = value;
            await this.plugin.saveSettings();
          });
        text.inputEl.rows = 6;
        text.inputEl.style.width = "100%";
      });

    // 사용자 경험 설정
    containerEl.createEl("h3", { text: t.ux });

    new Setting(containerEl)
      .setName(t.greeting)
      .setDesc(t.greetingDesc)
      .addText((text) =>
        text
          .setValue(this.plugin.settings.welcomeGreeting)
          .onChange(async (value) => {
            this.plugin.settings.welcomeGreeting = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(t.confirmToolExecution)
      .setDesc(t.confirmToolExecutionDesc)
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.confirmToolExecution)
          .onChange(async (value) => {
            this.plugin.settings.confirmToolExecution = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(t.autoAttach)
      .setDesc(t.autoAttachDesc)
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.autoAttachActiveNote)
          .onChange(async (value) => {
            this.plugin.settings.autoAttachActiveNote = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(t.persistChat)
      .setDesc(t.persistChatDesc)
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.persistChat)
          .onChange(async (value) => {
            this.plugin.settings.persistChat = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(t.clearHistory)
      .setDesc(t.clearHistoryDesc)
      .addButton((btn) =>
        btn
          .setButtonText(t.clearHistoryBtn)
          .setWarning()
          .onClick(async () => {
            await this.plugin.clearAllSessions();
            // 열려있는 채팅 뷰도 초기화
            const leaves = this.app.workspace.getLeavesOfType(BRANDING.viewType);
            for (const leaf of leaves) {
              (leaf.view as any).clearChat?.();
            }
            new Notice(t.clearHistoryConfirm);
          })
      );

    new Setting(containerEl)
      .setName(t.templateFolder)
      .setDesc(t.templateFolderDesc)
      .addText((text) =>
        text
          .setPlaceholder("Templates")
          .setValue(this.plugin.settings.templateFolder)
          .onChange(async (value) => {
            this.plugin.settings.templateFolder = value.trim() || "Templates";
            await this.plugin.saveSettings();
          })
      )
      .addButton((btn) =>
        btn.setIcon("folder").setTooltip("Browse").onClick(() => {
          new FolderSuggestModal(this.app, async (folder) => {
            this.plugin.settings.templateFolder = folder;
            await this.plugin.saveSettings();
            this.display();
          }, t.folderSelectPlaceholder).open();
        })
      );

    new Setting(containerEl)
      .setName(t.chatFontSize)
      .setDesc(t.chatFontSizeDesc)
      .addSlider((slider) =>
        slider
          .setLimits(10, 24, 1)
          .setValue(this.plugin.settings.chatFontSize)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.chatFontSize = value;
            await this.plugin.saveSettings();
            // 열려있는 채팅 뷰에 즉시 반영
            const leaves = this.app.workspace.getLeavesOfType(BRANDING.viewType);
            for (const leaf of leaves) {
              (leaf.view as any).applyFontSize?.();
            }
          })
      );

    // 코드 블록 설정
    containerEl.createEl("h3", { text: t.codeBlock });
    containerEl.createEl("p", {
      text: t.codeBlockDesc,
      cls: "setting-item-description",
    });

    const codeStylerSetting = new Setting(containerEl)
      .setName(t.codeStylerInstall)
      .setDesc(t.codeStylerInfo);
    codeStylerSetting.addButton((btn) =>
      btn.setButtonText(t.codeStylerInstall).onClick(() => {
        window.open("obsidian://show-plugin?id=code-styler");
      })
    );

    // To-Do 설정
    containerEl.createEl("h3", { text: t.todo });

    new Setting(containerEl)
      .setName(t.todoFolder)
      .setDesc(t.todoFolderDesc)
      .addText((text) =>
        text
          .setPlaceholder("ToDo")
          .setValue(this.plugin.settings.todoFolder)
          .onChange(async (value) => {
            this.plugin.settings.todoFolder = value.trim() || "ToDo";
            await this.plugin.saveSettings();
          })
      )
      .addButton((btn) =>
        btn.setIcon("folder").setTooltip("Browse").onClick(() => {
          new FolderSuggestModal(this.app, async (folder) => {
            this.plugin.settings.todoFolder = folder;
            await this.plugin.saveSettings();
            this.display();
          }, t.folderSelectPlaceholder).open();
        })
      );

    new Setting(containerEl)
      .setName(t.todoTemplate)
      .setDesc(t.todoTemplateDesc)
      .addText((text) =>
        text
          .setPlaceholder(t.todoTemplatePlaceholder)
          .setValue(this.plugin.settings.todoTemplateName)
          .onChange(async (value) => {
            this.plugin.settings.todoTemplateName = value.trim() || "Daily To-Do";
            await this.plugin.saveSettings();
          })
      );

    const tasksSetting = new Setting(containerEl)
      .setName(t.todoTasksInstall)
      .setDesc(t.todoTasksInfo);
    tasksSetting.addButton((btn) =>
      btn.setButtonText(t.todoTasksInstall).onClick(() => {
        window.open("obsidian://show-plugin?id=obsidian-tasks-plugin");
      })
    );

    new Setting(containerEl)
      .setName(t.todoArchiveFolder)
      .setDesc(t.todoArchiveFolderDesc)
      .addText((text) =>
        text
          .setPlaceholder("ToDo/Archive")
          .setValue(this.plugin.settings.todoArchiveFolder)
          .onChange(async (value) => {
            this.plugin.settings.todoArchiveFolder = value.trim() || "ToDo/Archive";
            await this.plugin.saveSettings();
          })
      )
      .addButton((btn) =>
        btn.setIcon("folder").setTooltip("Browse").onClick(() => {
          new FolderSuggestModal(this.app, async (folder) => {
            this.plugin.settings.todoArchiveFolder = folder;
            await this.plugin.saveSettings();
            this.display();
          }, t.folderSelectPlaceholder).open();
        })
      );

    new Setting(containerEl)
      .setName(t.todoArchiveDays)
      .setDesc(t.todoArchiveDaysDesc)
      .addSlider((slider) =>
        slider
          .setLimits(1, 30, 1)
          .setValue(this.plugin.settings.todoArchiveDays)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.todoArchiveDays = value;
            await this.plugin.saveSettings();
          })
      );

    // Obsidian 스킬 설정
    containerEl.createEl("h3", { text: t.skills });
    containerEl.createEl("p", {
      text: t.skillsDesc,
      cls: "setting-item-description",
    });

    for (const skill of SKILLS) {
      new Setting(containerEl)
        .setName(skill.name)
        .setDesc(this.plugin.settings.language === "en" ? skill.descriptionEn : skill.description)
        .addToggle((toggle) =>
          toggle
            .setValue(this.plugin.settings.enabledSkills.includes(skill.id))
            .onChange(async (value) => {
              const skills = this.plugin.settings.enabledSkills;
              if (value && !skills.includes(skill.id)) {
                skills.push(skill.id);
              } else if (!value) {
                const idx = skills.indexOf(skill.id);
                if (idx >= 0) skills.splice(idx, 1);
              }
              await this.plugin.saveSettings();
            })
        );
    }

    // MCP 서버 설정
    containerEl.createEl("h3", { text: t.mcpServers });

    // MCP 도구 타임아웃 슬라이더
    new Setting(containerEl)
      .setName(t.mcpTimeout)
      .setDesc(t.mcpTimeoutDesc)
      .addSlider((slider) =>
        slider
          .setLimits(10, 120, 5)
          .setValue(this.plugin.settings.mcpTimeout)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.mcpTimeout = value;
            await this.plugin.saveSettings();
            // 실행 중인 MCP 서버에 즉시 반영
            this.plugin.mcpManager.setTimeout(value);
          })
      );


    new Setting(containerEl)
      .setName(t.mcpManage)
      .setDesc(t.mcpManageDesc)
      .addButton((btn) =>
        btn.setButtonText(t.mcpEdit).onClick(() => {
          new McpConfigModal(this.app, this.plugin, () => this.display()).open();
        })
      )
      .addButton((btn) =>
        btn.setButtonText(t.mcpStopAll).onClick(() => {
          this.plugin.mcpManager.disconnectAll();
          new Notice(t.mcpStopped);
          this.display();
        })
      );

    // MCP 서버 상태 리스트 (관리 버튼 아래, 들여쓰기)
    const mcpStatus = this.plugin.mcpManager.getStatus();
    if (mcpStatus.length > 0) {
      const statusEl = containerEl.createDiv({ cls: "ba-mcp-status-list" });
      for (const s of mcpStatus) {
        const icon = s.connected ? "🟢" : "🔴";
        statusEl.createDiv({
          text: `${icon} ${s.name} — ${s.toolCount} tools`,
        });
      }
    } else {
      containerEl.createEl("p", {
        text: t.mcpNoServers,
        cls: "setting-item-description ba-mcp-status-list",
      });
    }
  }

  // 비밀 입력 필드 옆에 눈 아이콘 토글 버튼 추가
  private addToggleVisibilityButton(controlEl: HTMLElement): void {
    const wrapper = controlEl.querySelector(".setting-item-control") || controlEl;
    const input = wrapper.querySelector("input") as HTMLInputElement | null;
    if (!input) return;

    // 입력 필드를 감싸는 래퍼 생성
    const inputWrapper = createDiv({ cls: "ba-secret-wrapper" });
    input.parentElement?.insertBefore(inputWrapper, input);
    inputWrapper.appendChild(input);

    const eyeBtn = inputWrapper.createDiv({ cls: "ba-eye-btn", attr: { "aria-label": "Toggle visibility" } });
    // 초기 아이콘: 숨김 상태 (eye-off)
    setIcon(eyeBtn, "eye-off");

    eyeBtn.addEventListener("click", () => {
      const isPassword = input.type === "password";
      input.type = isPassword ? "text" : "password";
      eyeBtn.empty();
      setIcon(eyeBtn, isPassword ? "eye" : "eye-off");
    });
  }
}


// MCP 설정 편집 모달
class McpConfigModal extends Modal {
  private plugin: BedrockAssistantPlugin;
  private onSaved: () => void;
  private textArea!: HTMLTextAreaElement;
  private statusEl!: HTMLElement;

  constructor(app: App, plugin: BedrockAssistantPlugin, onSaved: () => void) {
    super(app);
    this.plugin = plugin;
    this.onSaved = onSaved;
  }

  async onOpen(): Promise<void> {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("ba-mcp-modal");
    const t = I18N[this.plugin.settings.language] || I18N.en;

    contentEl.createEl("h2", { text: t.mcpModalTitle });

    // 설명
    contentEl.createEl("p", {
      text: t.mcpModalDesc,
      cls: "ba-mcp-desc",
    });

    // 텍스트 에디터
    this.textArea = contentEl.createEl("textarea", { cls: "ba-mcp-editor" });
    this.textArea.rows = 16;
    this.textArea.spellcheck = false;
    this.textArea.placeholder = JSON.stringify(
      {
        mcpServers: {
          "example-server": {
            command: "npx",
            args: ["-y", "@example/mcp-server"],
            disabled: false,
          },
        },
      },
      null,
      2
    );

    // 현재 설정 로드
    const config = await this.plugin.readMcpConfig();
    this.textArea.value = config;

    // Tab 키로 들여쓰기 지원
    this.textArea.addEventListener("keydown", (e) => {
      if (e.key === "Tab") {
        e.preventDefault();
        const start = this.textArea.selectionStart;
        const end = this.textArea.selectionEnd;
        this.textArea.value =
          this.textArea.value.substring(0, start) + "  " + this.textArea.value.substring(end);
        this.textArea.selectionStart = this.textArea.selectionEnd = start + 2;
      }
    });

    // 연결 상태 표시 영역
    this.statusEl = contentEl.createDiv({ cls: "ba-mcp-status" });
    this.renderStatus();

    // 버튼 행
    const btnRow = contentEl.createDiv({ cls: "ba-mcp-btn-row" });

    const saveBtn = btnRow.createEl("button", {
      text: t.mcpModalSave,
      cls: "mod-cta",
    });
    saveBtn.addEventListener("click", () => this.handleSave());

    const cancelBtn = btnRow.createEl("button", { text: t.mcpModalCancel });
    cancelBtn.addEventListener("click", () => this.close());
  }

  private async handleSave(): Promise<void> {
    const configText = this.textArea.value.trim();
    const t = I18N[this.plugin.settings.language] || I18N.en;

    try {
      JSON.parse(configText);
    } catch {
      new Notice(t.mcpModalJsonError);
      return;
    }

    await this.plugin.saveMcpConfig(configText);
    new Notice(t.mcpModalSaving);

    const result = await this.plugin.loadMcpConfig();
    if (result.connected.length > 0) {
      new Notice(t.mcpModalConnected(result.connected.join(", ")));
    }
    if (result.failed.length > 0) {
      new Notice(t.mcpModalFailed(result.failed.join(", ")));
    }
    if (result.connected.length === 0 && result.failed.length === 0) {
      new Notice(t.mcpModalNoServers);
    }

    // 연결 상태 갱신 (모달 닫지 않음)
    this.renderStatus();
    this.onSaved();

    // 채팅 뷰의 MCP 인디케이터도 갱신
    const leaves = this.app.workspace.getLeavesOfType(BRANDING.viewType);
    for (const leaf of leaves) {
      (leaf.view as any).updateMcpIndicator?.();
    }
  }

  // 연결 상태 렌더링
  private renderStatus(): void {
    this.statusEl.empty();
    const t = I18N[this.plugin.settings.language] || I18N.en;
    const mcpStatus = this.plugin.mcpManager.getStatus();

    if (mcpStatus.length === 0) {
      this.statusEl.createDiv({ text: t.mcpStatusNone, cls: "ba-mcp-status-item" });
      return;
    }

    this.statusEl.createDiv({ text: t.mcpStatusTitle, cls: "ba-mcp-status-title" });
    for (const s of mcpStatus) {
      const item = this.statusEl.createDiv({ cls: "ba-mcp-status-item" });
      if (s.connected) {
        item.setText(`🟢 ${t.mcpModalTools(s.name, s.toolCount)}`);
      } else {
        item.setText(`🔴 ${t.mcpStatusDisconnected(s.name)}`);
      }
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}


// 볼트 폴더 검색/선택 모달
class FolderSuggestModal extends FuzzySuggestModal<TFolder> {
  private onChoose: (path: string) => void;

  constructor(app: App, onChoose: (path: string) => void, placeholder?: string) {
    super(app);
    this.onChoose = onChoose;
    this.setPlaceholder(placeholder || "Select a folder...");
  }

  getItems(): TFolder[] {
    const folders: TFolder[] = [];
    const recurse = (folder: TFolder) => {
      folders.push(folder);
      for (const child of folder.children) {
        if (child instanceof TFolder) recurse(child);
      }
    };
    recurse(this.app.vault.getRoot());
    return folders;
  }

  getItemText(item: TFolder): string {
    return item.path || "/";
  }

  onChooseItem(item: TFolder): void {
    this.onChoose(item.path);
  }
}
