import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type BedrockAssistantPlugin from "./main";
import { SKILLS } from "./skills";

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

    containerEl.createEl("h2", { text: "Assistant Kiro 설정" });

    // AWS 인증 설정
    containerEl.createEl("h3", { text: "AWS 인증" });

    new Setting(containerEl)
      .setName("AWS 리전")
      .setDesc("Bedrock을 사용할 AWS 리전")
      .addText((text) =>
        text
          .setPlaceholder("us-east-1")
          .setValue(this.plugin.settings.awsRegion)
          .onChange(async (value) => {
            this.plugin.settings.awsRegion = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("자격증명 소스")
      .setDesc("manual: 키 직접 입력 (설정 파일에 평문 저장됨), env: 환경변수/AWS 프로파일 사용 (권장)")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("manual", "직접 입력 (Manual)")
          .addOption("env", "환경변수/프로파일 (Env)")
          .setValue(this.plugin.settings.awsCredentialSource)
          .onChange(async (value) => {
            this.plugin.settings.awsCredentialSource = value as "manual" | "env";
            await this.plugin.saveSettings();
            this.display(); // UI 갱신
          })
      );

    if (this.plugin.settings.awsCredentialSource === "manual") {
      new Setting(containerEl)
        .setName("AWS Access Key ID")
        .setDesc("IAM 사용자의 Access Key ID")
        .addText((text) =>
          text
            .setPlaceholder("AKIA...")
            .setValue(this.plugin.settings.awsAccessKeyId)
            .onChange(async (value) => {
              this.plugin.settings.awsAccessKeyId = value.trim();
              await this.plugin.saveSettings();
            })
        );

      new Setting(containerEl)
        .setName("AWS Secret Access Key")
        .setDesc("IAM 사용자의 Secret Access Key")
        .addText((text) => {
          text
            .setPlaceholder("시크릿 키 입력")
            .setValue(this.plugin.settings.awsSecretAccessKey)
            .onChange(async (value) => {
              this.plugin.settings.awsSecretAccessKey = value.trim();
              await this.plugin.saveSettings();
            });
          text.inputEl.type = "password";
        });
    } else {
      new Setting(containerEl)
        .setName("AWS 프로파일")
        .setDesc("~/.aws/credentials 에서 사용할 프로파일 (비워두면 기본 체인 사용)")
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
    containerEl.createEl("h3", { text: "모델 설정" });

    new Setting(containerEl)
      .setName("채팅 모델")
      .setDesc("Bedrock Claude 모델 ID")
      .addText((text) =>
        text
          .setPlaceholder("anthropic.claude-sonnet-4-20250514-v1:0")
          .setValue(this.plugin.settings.chatModel)
          .onChange(async (value) => {
            this.plugin.settings.chatModel = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("임베딩 모델")
      .setDesc("Bedrock 임베딩 모델 ID")
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
    containerEl.createEl("h3", { text: "생성 설정" });

    new Setting(containerEl)
      .setName("최대 토큰")
      .setDesc("응답 최대 토큰 수")
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
      .setName("Temperature")
      .setDesc("응답 창의성 (0.0 ~ 1.0)")
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
      .setName("시스템 프롬프트")
      .setDesc("AI 어시스턴트의 기본 동작을 정의하는 프롬프트")
      .addTextArea((text) => {
        text
          .setPlaceholder("시스템 프롬프트를 입력하세요...")
          .setValue(this.plugin.settings.systemPrompt)
          .onChange(async (value) => {
            this.plugin.settings.systemPrompt = value;
            await this.plugin.saveSettings();
          });
        text.inputEl.rows = 6;
        text.inputEl.style.width = "100%";
      });

    // 사용자 경험 설정
    containerEl.createEl("h3", { text: "사용자 경험" });

    new Setting(containerEl)
      .setName("환영 인사")
      .setDesc("사이드바를 열 때 표시되는 인사말 (예: '뭐라고 불러 드릴까요?')")
      .addText((text) =>
        text
          .setPlaceholder("무엇을 도와드릴까요?")
          .setValue(this.plugin.settings.welcomeGreeting)
          .onChange(async (value) => {
            this.plugin.settings.welcomeGreeting = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("현재 노트 자동 첨부")
      .setDesc("메시지 전송 시 현재 열려있는 노트를 자동으로 컨텍스트에 포함합니다")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.autoAttachActiveNote)
          .onChange(async (value) => {
            this.plugin.settings.autoAttachActiveNote = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("대화 히스토리 저장")
      .setDesc("플러그인 재시작 후에도 대화 내용을 유지합니다")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.persistChat)
          .onChange(async (value) => {
            this.plugin.settings.persistChat = value;
            await this.plugin.saveSettings();
          })
      );

    // Obsidian 스킬 설정
    containerEl.createEl("h3", { text: "Obsidian 스킬" });
    containerEl.createEl("p", {
      text: "활성화된 스킬의 지식이 시스템 프롬프트에 추가되어 AI가 Obsidian 문법을 정확하게 사용합니다.",
      cls: "setting-item-description",
    });

    for (const skill of SKILLS) {
      new Setting(containerEl)
        .setName(skill.name)
        .setDesc(skill.description)
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
    containerEl.createEl("h3", { text: "MCP 서버" });

    // 연결 상태 표시
    const mcpStatus = this.plugin.mcpManager.getStatus();
    if (mcpStatus.length > 0) {
      const statusEl = containerEl.createDiv({ cls: "setting-item-description" });
      for (const s of mcpStatus) {
        const icon = s.connected ? "🟢" : "🔴";
        statusEl.createDiv({
          text: `${icon} ${s.name} — 도구 ${s.toolCount}개`,
        });
      }
    } else {
      containerEl.createEl("p", {
        text: "설정된 MCP 서버가 없습니다. 아래에서 mcp.json을 편집하세요.",
        cls: "setting-item-description",
      });
    }

    // MCP 설정 편집기
    const mcpEditorSetting = new Setting(containerEl)
      .setName("mcp.json 편집")
      .setDesc("MCP 서버 설정 (JSON). 저장 후 '서버 재연결' 버튼을 눌러 적용하세요.");

    const mcpTextArea = containerEl.createEl("textarea", {
      cls: "ba-mcp-editor",
    });
    mcpTextArea.rows = 12;
    mcpTextArea.style.width = "100%";
    mcpTextArea.style.fontFamily = "var(--font-monospace)";
    mcpTextArea.style.fontSize = "13px";
    mcpTextArea.style.resize = "vertical";
    mcpTextArea.placeholder = JSON.stringify(
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
    this.plugin.readMcpConfig().then((config) => {
      mcpTextArea.value = config;
    });

    // 저장 + 재연결 버튼
    new Setting(containerEl)
      .addButton((btn) =>
        btn.setButtonText("저장 및 서버 재연결").onClick(async () => {
          const configText = mcpTextArea.value.trim();

          // JSON 유효성 검사
          try {
            JSON.parse(configText);
          } catch {
            new Notice("❌ JSON 형식이 올바르지 않습니다.");
            return;
          }

          await this.plugin.saveMcpConfig(configText);
          new Notice("MCP 설정 저장됨. 서버 연결 중...");

          const result = await this.plugin.loadMcpConfig();
          if (result.connected.length > 0) {
            new Notice(`✅ MCP 서버 연결: ${result.connected.join(", ")}`);
          }
          if (result.failed.length > 0) {
            new Notice(`❌ MCP 서버 실패: ${result.failed.join(", ")}`);
          }
          if (result.connected.length === 0 && result.failed.length === 0) {
            new Notice("설정된 MCP 서버가 없습니다.");
          }

          // UI 갱신
          this.display();
        })
      )
      .addButton((btn) =>
        btn.setButtonText("서버 모두 종료").onClick(() => {
          this.plugin.mcpManager.disconnectAll();
          new Notice("모든 MCP 서버 연결이 종료되었습니다.");
          this.display();
        })
      );
  }
}
