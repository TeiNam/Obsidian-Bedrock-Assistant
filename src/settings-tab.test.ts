import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { normalizeTraversalDepth } from "./graph-rag/graph-traversal";
import { normalizeChunkConfig } from "./graph-rag/chunker";

// ============================================
// settings-tab 설정 보정 단위 테스트 (Task 10.2)
// ============================================
// 설정 탭(settings-tab.ts)은 사용자가 입력한 Graph RAG 값을 저장하기 전에
// normalizeTraversalDepth / normalizeChunkConfig 로 보정한다.
// Obsidian Setting UI 전체를 테스트하는 것은 비현실적이므로,
// 설정 저장 경로가 의존하는 "보정 로직" 자체를 예제 기반 단위 테스트로 검증한다.
// (Req 9.4, 9.5, 9.6, 9.7)

// --------------------------------------------
// normalizeTraversalDepth — 탐색 깊이 보정 (Req 9.4, 9.5)
// --------------------------------------------
describe("normalizeTraversalDepth: 탐색 깊이 보정", () => {
  it("음수 입력은 0으로 보정한다 (Req 9.4)", () => {
    // 0 미만 → 0
    expect(normalizeTraversalDepth(-1)).toBe(0);
    expect(normalizeTraversalDepth(-5)).toBe(0);
    // -0 도 0 으로 정규화
    expect(Object.is(normalizeTraversalDepth(-0.4), 0)).toBe(true);
  });

  it("3을 초과하는 입력은 3으로 보정한다 (Req 9.5)", () => {
    // 3 초과 → 3
    expect(normalizeTraversalDepth(4)).toBe(3);
    expect(normalizeTraversalDepth(100)).toBe(3);
  });

  it("정수가 아닌 입력은 가장 가까운 정수로 반올림한다 (Req 9.5)", () => {
    // 비정수 → 반올림 후 0~3 범위 클램프
    expect(normalizeTraversalDepth(1.4)).toBe(1);
    expect(normalizeTraversalDepth(1.5)).toBe(2);
    expect(normalizeTraversalDepth(2.6)).toBe(3);
    // 반올림 결과가 범위를 벗어나면 클램프된다
    expect(normalizeTraversalDepth(3.4)).toBe(3);
    expect(normalizeTraversalDepth(-0.6)).toBe(0);
  });

  it("유효 범위(0~3 정수) 입력은 그대로 유지한다", () => {
    // 경계 및 내부 값 보존
    expect(normalizeTraversalDepth(0)).toBe(0);
    expect(normalizeTraversalDepth(1)).toBe(1);
    expect(normalizeTraversalDepth(2)).toBe(2);
    expect(normalizeTraversalDepth(3)).toBe(3);
  });

  it("유한하지 않은 값(NaN, Infinity)은 0으로 보정한다", () => {
    expect(normalizeTraversalDepth(NaN)).toBe(0);
    expect(normalizeTraversalDepth(Infinity)).toBe(0);
    expect(normalizeTraversalDepth(-Infinity)).toBe(0);
  });
});

// --------------------------------------------
// normalizeChunkConfig — 청크 설정 보정 (Req 9.6, 9.7)
// --------------------------------------------
describe("normalizeChunkConfig: 청크 설정 보정", () => {
  it("maxSize가 1 미만이면 1로 보정한다 (Req 9.7)", () => {
    // maxSize < 1 → 1
    expect(normalizeChunkConfig(0, 0).maxSize).toBe(1);
    expect(normalizeChunkConfig(-100, 0).maxSize).toBe(1);
    // maxSize가 1로 보정되면 overlap은 maxSize-1(=0) 이하로 유지된다
    const normalized = normalizeChunkConfig(0, 5);
    expect(normalized.maxSize).toBe(1);
    expect(normalized.overlap).toBe(0);
  });

  it("overlap이 maxSize 이상이면 maxSize-1로 보정한다 (Req 9.6)", () => {
    // overlap >= maxSize → maxSize - 1
    expect(normalizeChunkConfig(2000, 2000)).toEqual({ maxSize: 2000, overlap: 1999 });
    expect(normalizeChunkConfig(2000, 5000)).toEqual({ maxSize: 2000, overlap: 1999 });
    expect(normalizeChunkConfig(10, 10)).toEqual({ maxSize: 10, overlap: 9 });
  });

  it("음수 overlap은 0으로 보정한다", () => {
    // overlap < 0 → 0 (설계 불변식 0 <= overlap)
    expect(normalizeChunkConfig(2000, -1)).toEqual({ maxSize: 2000, overlap: 0 });
    expect(normalizeChunkConfig(2000, -999)).toEqual({ maxSize: 2000, overlap: 0 });
  });

  it("유효한 값은 그대로 유지한다", () => {
    // 0 <= overlap < maxSize 이고 maxSize >= 1 인 정상 입력은 보존
    expect(normalizeChunkConfig(2000, 200)).toEqual({ maxSize: 2000, overlap: 200 });
    expect(normalizeChunkConfig(1, 0)).toEqual({ maxSize: 1, overlap: 0 });
    expect(normalizeChunkConfig(100, 99)).toEqual({ maxSize: 100, overlap: 99 });
  });

  it("보정 결과는 항상 maxSize>=1 이고 0<=overlap<maxSize 불변식을 만족한다", () => {
    // 다양한 비정상 입력 조합에서 불변식 검증
    const inputs: Array<[number, number]> = [
      [0, 0],
      [-10, -10],
      [1, 5],
      [2000, 2000],
      [5, -3],
      [NaN, NaN],
      [Infinity, Infinity],
    ];
    for (const [maxSize, overlap] of inputs) {
      const cfg = normalizeChunkConfig(maxSize, overlap);
      expect(cfg.maxSize).toBeGreaterThanOrEqual(1);
      expect(cfg.overlap).toBeGreaterThanOrEqual(0);
      expect(cfg.overlap).toBeLessThan(cfg.maxSize);
    }
  });
});


// ============================================================================
// Multi-Provider 설정 UI 예시/모킹 테스트 (Task 8.2)
// ============================================================================
// 설정 탭(settings-tab.ts)의 멀티 프로바이더(OpenAI/Ollama) 조건부 UI·검증·
// 모델 드롭다운·i18n 동작을 예시/모킹 기반으로 검증한다.
//
// Obsidian의 Setting 빌더와 DOM API는 앱 내에서만 동작하므로,
// vi.hoisted로 "캡처형(capturing) Setting 모킹"과 "범용 element/component 프록시"를
// 구성하여 display()와 내부 헬퍼(addBaseUrlSetting / addProviderModelDropdown)를
// 실제로 실행하고 그 결과(생성된 Setting 이름, 입력 마스킹, 옵션/값, Notice)를 관찰한다.
// (Req 2.10, 3.7, 7.9, 7.9.1, 12.1~12.4, 13.1~13.3)

// vi.hoisted: vi.mock 팩토리보다 먼저 평가되어 모킹에서 공유 상태/헬퍼를 사용 가능하게 한다.
const h = vi.hoisted(() => {
  // 생성된 Setting 인스턴스 기록 (display/헬퍼 실행 결과 관찰용)
  const settingRegistry: any[] = [];
  // Notice로 표시된 메시지 기록 (base URL 형식 오류 검증용)
  const noticeMessages: string[] = [];

  // 범용 element 프록시: 임의의 DOM 메서드 호출을 견디는 체이닝 no-op 스텁.
  // create*/querySelector 등은 새 element를, 알 수 없는 메서드는 자기 자신을 반환한다.
  function makeEl(): any {
    const store: Record<string, any> = {};
    // inputEl/selectEl 등 "element 타입" 속성은 또 다른 element 프록시로 캐싱한다.
    const elementProps = new Set([
      "inputEl", "selectEl", "controlEl", "contentEl", "containerEl",
      "parentElement", "buttonEl", "sliderEl", "toggleEl", "settingEl",
      "nameEl", "descEl", "extraSettingsEl",
    ]);
    const target: any = function () {};
    const proxy: any = new Proxy(target, {
      get(_t, prop: any) {
        if (typeof prop === "symbol") return undefined;
        if (prop === "then") return undefined; // thenable 오인 방지
        if (prop in store) return store[prop];
        if (elementProps.has(prop)) { store[prop] = makeEl(); return store[prop]; }
        if (prop === "style") { store.style = store.style || {}; return store.style; }
        if (prop === "classList") return { add() {}, remove() {}, toggle() {}, contains() { return false; } };
        if (prop === "value") return store.value ?? "";
        if (prop === "type") return store.type ?? "text";
        if (prop === "createDiv" || prop === "createEl" || prop === "createSpan") return (..._a: any[]) => makeEl();
        if (prop === "querySelector") return (..._a: any[]) => makeEl();
        if (prop === "querySelectorAll") return (..._a: any[]) => [];
        // 알 수 없는 메서드: 체이닝 가능한 no-op (자기 자신 반환)
        return (..._a: any[]) => proxy;
      },
      set(_t, prop: any, value) { store[prop] = value; return true; },
      apply() { return makeEl(); },
    });
    return proxy;
  }

  // 범용 component 프록시: Setting의 addText/addDropdown/addToggle 등이 콜백에 넘기는 빌더.
  // addOption/setValue/getValue/onChange/onClick은 상태를 캡처하고, 그 외 빌더 메서드는
  // 체이닝 no-op으로 처리한다. selectEl.empty()는 옵션 배열을 비워 실제 DOM을 모사한다.
  function makeComp(): any {
    const store: any = { _value: "", _onChange: null, _onClick: null, options: [] };
    store.inputEl = makeEl();
    store.selectEl = makeEl();
    store.buttonEl = makeEl();
    const proxy: any = new Proxy(store, {
      get(t, prop: any) {
        if (typeof prop === "symbol") return undefined;
        if (prop in t) return t[prop];
        if (prop === "addOption") return (v: string, l: string) => { t.options.push({ value: v, label: l }); return proxy; };
        if (prop === "setValue") return (v: any) => { t._value = v; return proxy; };
        if (prop === "getValue") return () => t._value;
        if (prop === "onChange") return (fn: any) => { t._onChange = fn; return proxy; };
        if (prop === "onClick") return (fn: any) => { t._onClick = fn; return proxy; };
        // 알 수 없는 빌더 메서드: 체이닝 no-op
        return (..._a: any[]) => proxy;
      },
      set(t, prop: any, value) { t[prop] = value; return true; },
    });
    // 드롭다운 갱신 시 select 비우기 모사 (옵션 배열 초기화)
    store.selectEl.empty = () => { store.options.length = 0; };
    return proxy;
  }

  // 캡처형 Setting: 생성된 이름/설명/컴포넌트를 기록한다. 알 수 없는 빌더 메서드도 견딘다.
  function createSetting(): any {
    const t: any = {
      nameVal: "", descVal: "", heading: false, controlEl: makeEl(),
      texts: [], dropdowns: [], toggles: [], buttons: [], sliders: [], textareas: [], extras: [],
    };
    const api: any = new Proxy(t, {
      get(target, prop: any) {
        if (prop in target) return target[prop];
        if (typeof prop === "symbol") return undefined;
        const known: Record<string, (...a: any[]) => any> = {
          setName: (n: any) => { target.nameVal = typeof n === "string" ? n : String(n ?? ""); return api; },
          setDesc: (d: any) => { target.descVal = typeof d === "string" ? d : String(d ?? ""); return api; },
          setHeading: () => { target.heading = true; return api; },
          setClass: () => api,
          addText: (cb?: any) => { const c = makeComp(); target.texts.push(c); cb?.(c); return api; },
          addTextArea: (cb?: any) => { const c = makeComp(); target.textareas.push(c); cb?.(c); return api; },
          addToggle: (cb?: any) => { const c = makeComp(); target.toggles.push(c); cb?.(c); return api; },
          addButton: (cb?: any) => { const c = makeComp(); target.buttons.push(c); cb?.(c); return api; },
          addExtraButton: (cb?: any) => { const c = makeComp(); target.extras.push(c); cb?.(c); return api; },
          addDropdown: (cb?: any) => { const c = makeComp(); target.dropdowns.push(c); cb?.(c); return api; },
          addSlider: (cb?: any) => { const c = makeComp(); target.sliders.push(c); cb?.(c); return api; },
        };
        if (prop in known) return known[prop];
        // 알 수 없는 Setting 빌더 메서드 → 체이닝 no-op
        return (..._a: any[]) => api;
      },
    });
    settingRegistry.push(api);
    return api;
  }

  class MockSetting {
    constructor(_containerEl?: any) {
      // 생성자에서 캡처형 객체를 반환하여 인스턴스를 대체한다.
      return createSetting();
    }
  }

  class MockNotice {
    constructor(message?: any) {
      noticeMessages.push(String(message ?? ""));
    }
  }

  return { settingRegistry, noticeMessages, makeEl, makeComp, MockSetting, MockNotice };
});

// obsidian 모듈을 캡처형 Setting / Notice 로 모킹한다.
// settings-tab.ts 및 그것이 import하는 모달들이 평가 시 필요로 하는 클래스 스텁도 제공한다.
vi.mock("obsidian", () => ({
  App: class {},
  Notice: h.MockNotice,
  Setting: h.MockSetting,
  setIcon: () => {},
  normalizePath: (p: string) => p,
  TFile: class {},
  TFolder: class {},
  Modal: class {
    app: unknown;
    contentEl: any = h.makeEl();
    constructor(app?: unknown) { this.app = app; }
    open() {}
    close() {}
  },
  PluginSettingTab: class {
    app: any;
    plugin: any;
    containerEl: any = h.makeEl();
    constructor(app?: any, plugin?: any) { this.app = app; this.plugin = plugin; }
    display() {}
  },
  FuzzySuggestModal: class {
    app: unknown;
    constructor(app?: unknown) { this.app = app; }
    getItems() { return []; }
    getItemText() { return ""; }
    onChooseItem() {}
    open() {}
  },
}));

// 모킹 이후 대상 모듈 import (vitest가 vi.mock을 호이스팅하므로 모킹이 선 적용됨)
import { GeminiSettingTab, I18N } from "./settings-tab";
import { DEFAULT_SETTINGS } from "./types";

// 비동기 마이크로/매크로태스크 플러시 (listModels 비동기 IIFE 완료 대기)
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

// 테스트용 설정 탭 + plugin/app 스텁 생성
function makeTab(opts?: { settings?: Record<string, unknown>; listModels?: (...a: any[]) => Promise<any[]> }) {
  const plugin: any = {
    settings: { ...structuredClone(DEFAULT_SETTINGS), ...(opts?.settings ?? {}) },
    saveSettings: vi.fn(async () => {}),
    recreateAiClient: vi.fn(),
    clearAllSessions: vi.fn(async () => {}),
    readMcpConfig: vi.fn(async () => "{}"),
    saveMcpConfig: vi.fn(async () => {}),
    loadMcpConfig: vi.fn(async () => ({ connected: [], failed: [] })),
    aiClient: { listModels: opts?.listModels ?? vi.fn(async () => []) },
    indexer: { setSearchOptions: vi.fn(), client: {} },
    mcpManager: { getStatus: () => [], setTimeout: vi.fn(), disconnectAll: vi.fn() },
  };
  const app: any = {
    vault: {
      configDir: ".obsidian",
      adapter: { read: async () => "" },
      getAbstractFileByPath: () => null,
      getMarkdownFiles: () => [],
      getRoot: () => ({ path: "", name: "", children: [] }),
    },
    workspace: {
      getLeavesOfType: () => [],
      getLeaf: () => ({ openFile: async () => ({ catch: () => {} }) }),
    },
  };
  const tab: any = new GeminiSettingTab(app, plugin);
  tab.containerEl = h.makeEl();
  return { tab, plugin, app };
}

describe("Multi-Provider 설정 UI (Task 8.2)", () => {
  beforeEach(() => {
    // Obsidian 전역 헬퍼(createDiv 등) 스텁 — addToggleVisibilityButton이 bare createDiv 사용
    (globalThis as any).createDiv = () => h.makeEl();
    (globalThis as any).createEl = () => h.makeEl();
    (globalThis as any).createSpan = () => h.makeEl();
    h.settingRegistry.length = 0;
    h.noticeMessages.length = 0;
  });

  afterEach(() => {
    delete (globalThis as any).createDiv;
    delete (globalThis as any).createEl;
    delete (globalThis as any).createSpan;
  });

  // --------------------------------------------------------------------------
  // 백엔드별 조건부 필드 표시/비표시 + password 마스킹 (Req 12.1, 12.2, 3.7)
  // --------------------------------------------------------------------------
  describe("백엔드별 조건부 필드 표시/비표시 + 마스킹", () => {
    it("OpenAI 백엔드: API 키(마스킹)·base URL·채팅/임베딩 모델 필드를 표시하고 타 백엔드 필드는 숨긴다", () => {
      const { tab } = makeTab({ settings: { aiBackend: "openai", language: "en" } });
      h.settingRegistry.length = 0;
      tab.display();

      const names = h.settingRegistry.map((s: any) => s.nameVal);
      // OpenAI 전용 필드 표시 (Req 12.1)
      expect(names).toContain(I18N.en.openaiApiKey);
      expect(names).toContain(I18N.en.openaiBaseUrl);
      expect(names).toContain(I18N.en.openaiChatModel);
      expect(names).toContain(I18N.en.openaiEmbeddingModel);
      // 타 백엔드 전용 필드 비표시
      expect(names).not.toContain(I18N.en.awsAccessKeyLabel); // Bedrock
      expect(names).not.toContain(I18N.en.ollamaBaseUrl); // Ollama
      expect(names).not.toContain(I18N.en.apiKey); // Gemini API Key

      // API 키 입력은 password 타입으로 마스킹 (Req 3.7)
      const keySetting = h.settingRegistry.find((s: any) => s.nameVal === I18N.en.openaiApiKey);
      expect(keySetting).toBeTruthy();
      expect(keySetting.texts[0].inputEl.type).toBe("password");
    });

    it("Ollama 백엔드: 서버 base URL·채팅/임베딩 모델 필드를 표시하고 API 키/마스킹 필드는 없다", () => {
      const { tab } = makeTab({ settings: { aiBackend: "ollama", language: "en" } });
      h.settingRegistry.length = 0;
      tab.display();

      const names = h.settingRegistry.map((s: any) => s.nameVal);
      // Ollama 전용 필드 표시 (Req 12.2)
      expect(names).toContain(I18N.en.ollamaServer);
      expect(names).toContain(I18N.en.ollamaBaseUrl);
      expect(names).toContain(I18N.en.ollamaChatModel);
      expect(names).toContain(I18N.en.ollamaEmbeddingModel);
      // 타 백엔드 전용 필드 비표시
      expect(names).not.toContain(I18N.en.openaiApiKey);
      expect(names).not.toContain(I18N.en.awsAccessKeyLabel);

      // Ollama는 API 키가 없으므로 password로 마스킹된 입력이 존재하지 않아야 한다 (Req 12.2)
      const anyPasswordInput = h.settingRegistry.some(
        (s: any) => s.texts.some((t: any) => t.inputEl.type === "password"),
      );
      expect(anyPasswordInput).toBe(false);
    });

    it("Gemini 백엔드: OpenAI/Ollama 전용 필드를 표시하지 않는다", () => {
      const { tab } = makeTab({ settings: { aiBackend: "gemini", language: "en" } });
      h.settingRegistry.length = 0;
      tab.display();

      const names = h.settingRegistry.map((s: any) => s.nameVal);
      expect(names).toContain(I18N.en.apiKey); // Gemini API Key 표시
      expect(names).not.toContain(I18N.en.openaiApiKey);
      expect(names).not.toContain(I18N.en.ollamaBaseUrl);
    });
  });

  // --------------------------------------------------------------------------
  // base URL 검증: 잘못된 scheme 거부 + 이전 값 유지 (Req 2.10)
  // --------------------------------------------------------------------------
  describe("base URL 검증 (addBaseUrlSetting)", () => {
    it("잘못된 scheme 입력은 Notice로 거부하고 이전 유효값을 유지한다", async () => {
      const { tab, plugin } = makeTab({
        settings: { aiBackend: "openai", language: "en", openaiBaseUrl: "https://api.openai.com/v1" },
      });
      h.settingRegistry.length = 0;
      h.noticeMessages.length = 0;

      // 헬퍼를 직접 호출하여 base URL 입력 onChange 동작을 관찰한다.
      tab.addBaseUrlSetting(
        h.makeEl(),
        "Base URL",
        "desc",
        "ph",
        () => plugin.settings.openaiBaseUrl,
        (v: string) => { plugin.settings.openaiBaseUrl = v; },
        "INVALID_BASE_URL",
      );
      const text = h.settingRegistry.at(-1).texts[0];

      // scheme이 http(s)가 아닌 경우: 거부 + 이전 값 유지
      await text._onChange("ftp://bad.example.com");
      expect(h.noticeMessages).toContain("INVALID_BASE_URL");
      expect(plugin.settings.openaiBaseUrl).toBe("https://api.openai.com/v1");

      // scheme 자체가 없는 문자열도 거부
      await text._onChange("not-a-url");
      expect(plugin.settings.openaiBaseUrl).toBe("https://api.openai.com/v1");
    });

    it("유효한 http(s) base URL은 수락하고 영속 저장한다", async () => {
      const { tab, plugin } = makeTab({
        settings: { aiBackend: "openai", language: "en", openaiBaseUrl: "https://api.openai.com/v1" },
      });
      h.settingRegistry.length = 0;

      tab.addBaseUrlSetting(
        h.makeEl(),
        "Base URL",
        "desc",
        "ph",
        () => plugin.settings.openaiBaseUrl,
        (v: string) => { plugin.settings.openaiBaseUrl = v; },
        "INVALID_BASE_URL",
      );
      const text = h.settingRegistry.at(-1).texts[0];

      await text._onChange("https://proxy.local/v1");
      expect(plugin.settings.openaiBaseUrl).toBe("https://proxy.local/v1");
      expect(plugin.saveSettings).toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  // 채팅/임베딩 모델 드롭다운 (addProviderModelDropdown) — Req 7.9, 7.9.1, 12.3, 12.4
  // --------------------------------------------------------------------------
  describe("모델 드롭다운 (addProviderModelDropdown)", () => {
    it("listModels가 빈 배열이면 현재값을 유지한다 (Req 7.9, 12.4)", async () => {
      const listModels = vi.fn(async () => []);
      const { tab, plugin } = makeTab({
        settings: { aiBackend: "openai", language: "en", openaiChatModel: "gpt-current" },
        listModels,
      });
      h.settingRegistry.length = 0;

      tab.addProviderModelDropdown(
        h.makeEl(), "Chat", "desc",
        () => plugin.settings.openaiChatModel,
        (v: string) => { plugin.settings.openaiChatModel = v; },
        "chat",
      );
      const dd = h.settingRegistry.at(-1).dropdowns[0];
      await flush();

      expect(listModels).toHaveBeenCalledWith("chat");
      expect(dd._value).toBe("gpt-current");
      expect(dd.options.map((o: any) => o.value)).toContain("gpt-current");
    });

    it("listModels가 오류를 던지면 현재값을 유지한다 (Req 7.9, 12.4)", async () => {
      const listModels = vi.fn(async () => { throw new Error("network error"); });
      const { tab, plugin } = makeTab({
        settings: { aiBackend: "openai", language: "en", openaiChatModel: "gpt-current" },
        listModels,
      });
      h.settingRegistry.length = 0;

      tab.addProviderModelDropdown(
        h.makeEl(), "Chat", "desc",
        () => plugin.settings.openaiChatModel,
        (v: string) => { plugin.settings.openaiChatModel = v; },
        "chat",
      );
      const dd = h.settingRegistry.at(-1).dropdowns[0];
      await flush();

      expect(dd._value).toBe("gpt-current");
      expect(dd.options.map((o: any) => o.value)).toContain("gpt-current");
    });

    it("정상 목록이지만 현재 ID가 목록에 없으면 현재값을 옵션으로 유지·선택한다 (Req 7.9.1)", async () => {
      const listModels = vi.fn(async () => [
        { modelId: "model-a", modelName: "Model A", provider: "openai" },
        { modelId: "model-b", modelName: "Model B", provider: "openai" },
      ]);
      const { tab, plugin } = makeTab({
        settings: { aiBackend: "openai", language: "en", openaiChatModel: "gpt-missing" },
        listModels,
      });
      h.settingRegistry.length = 0;

      tab.addProviderModelDropdown(
        h.makeEl(), "Chat", "desc",
        () => plugin.settings.openaiChatModel,
        (v: string) => { plugin.settings.openaiChatModel = v; },
        "chat",
      );
      const dd = h.settingRegistry.at(-1).dropdowns[0];
      await flush();

      // 현재값이 목록에 없어도 선택값으로 유지되고 옵션에 포함된다
      expect(dd._value).toBe("gpt-missing");
      const values = dd.options.map((o: any) => o.value);
      expect(values).toContain("gpt-missing");
      expect(values).toContain("model-a");
      expect(values).toContain("model-b");
    });

    it("정상 목록에 현재 ID가 존재하면 현재값을 선택 유지한다", async () => {
      const listModels = vi.fn(async () => [
        { modelId: "gpt-current", modelName: "Current", provider: "openai" },
        { modelId: "model-b", modelName: "Model B", provider: "openai" },
      ]);
      const { tab, plugin } = makeTab({
        settings: { aiBackend: "openai", language: "en", openaiChatModel: "gpt-current" },
        listModels,
      });
      h.settingRegistry.length = 0;

      tab.addProviderModelDropdown(
        h.makeEl(), "Chat", "desc",
        () => plugin.settings.openaiChatModel,
        (v: string) => { plugin.settings.openaiChatModel = v; },
        "chat",
      );
      const dd = h.settingRegistry.at(-1).dropdowns[0];
      await flush();

      expect(dd._value).toBe("gpt-current");
      expect(dd.options.map((o: any) => o.value)).toContain("gpt-current");
    });

    it("임베딩 드롭다운은 listModels를 'embedding' 종류로 호출한다 (Req 12.3)", async () => {
      const listModels = vi.fn(async () => []);
      const { tab, plugin } = makeTab({
        settings: { aiBackend: "openai", language: "en", openaiEmbeddingModel: "emb-current" },
        listModels,
      });
      h.settingRegistry.length = 0;

      tab.addProviderModelDropdown(
        h.makeEl(), "Embedding", "desc",
        () => plugin.settings.openaiEmbeddingModel,
        (v: string) => { plugin.settings.openaiEmbeddingModel = v; },
        "embedding",
      );
      await flush();

      expect(listModels).toHaveBeenCalledWith("embedding");
    });
  });

  // --------------------------------------------------------------------------
  // 신규 라벨 i18n 키 완전성 (en/ko/ja) + en 폴백 (Req 13.1, 13.2, 13.3)
  // --------------------------------------------------------------------------
  describe("i18n 키 완전성 및 en 폴백", () => {
    // OpenAI/Ollama 백엔드 관련 신규 라벨/설명 키 목록
    const NEW_LABEL_KEYS = [
      "aiBackendLabel", "aiBackendDesc",
      "openaiAuth", "openaiApiKey", "openaiApiKeyDesc", "openaiApiKeyPlaceholder",
      "openaiBaseUrl", "openaiBaseUrlDesc", "openaiBaseUrlPlaceholder",
      "openaiChatModel", "openaiChatModelDesc",
      "openaiEmbeddingModel", "openaiEmbeddingModelDesc",
      "ollamaServer", "ollamaBaseUrl", "ollamaBaseUrlDesc", "ollamaBaseUrlPlaceholder",
      "ollamaChatModel", "ollamaChatModelDesc",
      "ollamaEmbeddingModel", "ollamaEmbeddingModelDesc",
      "baseUrlInvalid",
    ] as const;

    it("en/ko/ja 모두 신규 라벨 키를 비어있지 않은 문자열로 보유한다 (Req 13.1, 13.2)", () => {
      for (const lang of ["en", "ko", "ja"] as const) {
        const dict = I18N[lang] as Record<string, unknown>;
        for (const key of NEW_LABEL_KEYS) {
          expect(typeof dict[key], `${lang}.${key}`).toBe("string");
          expect((dict[key] as string).length, `${lang}.${key} non-empty`).toBeGreaterThan(0);
        }
      }
    });

    it("현재 언어에 키가 있으면 해당 언어 값을, 없으면 en 값으로 폴백한다 (Req 13.3)", () => {
      // settings-tab.ts의 tk(키 단위 en 폴백) 로직과 동일한 알고리즘으로 검증한다.
      const tk = (dict: Record<string, unknown>, key: string): string => {
        const cur = dict[key];
        if (typeof cur === "string") return cur;
        const en = (I18N.en as Record<string, unknown>)[key];
        return typeof en === "string" ? en : "";
      };

      // 현재 언어(ko)에 키가 존재하면 ko 값을 그대로 사용
      expect(tk(I18N.ko as Record<string, unknown>, "ollamaServer")).toBe(I18N.ko.ollamaServer);

      // 현재 언어에 키가 없는 경우(ko 사본에서 제거) en 값으로 폴백
      const koMissing = { ...(I18N.ko as Record<string, unknown>) };
      delete koMissing["openaiAuth"];
      expect(tk(koMissing, "openaiAuth")).toBe(I18N.en.openaiAuth);

      // en에도 없는 키는 빈 문자열로 폴백
      expect(tk(koMissing, "__nonexistent_key__")).toBe("");
    });
  });
});
