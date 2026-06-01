// obsidian 패키지 테스트용 모킹
// Obsidian API는 앱 내에서만 사용 가능하므로 테스트 환경에서는 최소한의 스텁 제공

export class Notice {
  constructor(_message: string) {
    // 테스트에서는 알림 무시
  }
}

export class TFile {
  path = "";
  basename = "";
  stat = { mtime: 0 };
}

// 폴더 추상 클래스 스텁 (모듈 평가 시 타입 참조용)
export class TFolder {
  path = "";
  name = "";
  children: unknown[] = [];
}

export class App {
  vault = {
    getMarkdownFiles: () => [],
    cachedRead: async () => "",
    getAbstractFileByPath: () => null,
  };
}

// 테스트 환경에서는 경로를 그대로 반환하는 스텁
export function normalizePath(path: string): string {
  return path;
}

// 아이콘 설정 스텁 (DOM 부수효과 없음)
export function setIcon(_el: unknown, _icon: string): void {
  // 테스트에서는 무시
}

// settings-tab.ts 및 모달 모듈이 `extends` 하는 클래스들의 최소 스텁.
// 이 스텁들은 모듈 평가(class extends ...)가 테스트 환경에서 실패하지 않도록 제공된다.
export class Modal {
  app: unknown;
  contentEl: unknown = {};
  constructor(app?: unknown) {
    this.app = app;
  }
  open(): void {
    // 무시
  }
  close(): void {
    // 무시
  }
}

export class PluginSettingTab {
  app: unknown;
  plugin: unknown;
  containerEl: unknown = {};
  constructor(app?: unknown, plugin?: unknown) {
    this.app = app;
    this.plugin = plugin;
  }
  display(): void {
    // 무시
  }
}

export class FuzzySuggestModal<T> {
  app: unknown;
  constructor(app?: unknown) {
    this.app = app;
  }
  getItems(): T[] {
    return [];
  }
  getItemText(_item: T): string {
    return "";
  }
  onChooseItem(_item: T, _evt: unknown): void {
    // 무시
  }
  open(): void {
    // 무시
  }
}

// Setting 빌더 스텁 (체이닝 메서드는 자기 자신을 반환)
export class Setting {
  constructor(_containerEl?: unknown) {
    // 무시
  }
  setName(_name: string): this {
    return this;
  }
  setDesc(_desc: string): this {
    return this;
  }
  setHeading(): this {
    return this;
  }
  addText(_cb?: (text: unknown) => unknown): this {
    return this;
  }
  addTextArea(_cb?: (text: unknown) => unknown): this {
    return this;
  }
  addToggle(_cb?: (toggle: unknown) => unknown): this {
    return this;
  }
  addButton(_cb?: (btn: unknown) => unknown): this {
    return this;
  }
  addDropdown(_cb?: (dd: unknown) => unknown): this {
    return this;
  }
  addSlider(_cb?: (slider: unknown) => unknown): this {
    return this;
  }
  addExtraButton(_cb?: (btn: unknown) => unknown): this {
    return this;
  }
  setClass(_cls: string): this {
    return this;
  }
}
