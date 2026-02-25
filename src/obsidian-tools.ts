import { App, TFile, TFolder, MarkdownView, Notice } from "obsidian";
import type { VaultIndexer } from "./vault-indexer";
import type { ToolDefinition } from "./types";

// Obsidian 제어 도구 목록
export const TOOLS: ToolDefinition[] = [
  {
    name: "search_vault",
    description: "볼트에서 시맨틱 검색을 수행합니다. 사용자의 노트 중 질문과 관련된 내용을 찾습니다.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "검색 쿼리" },
        limit: { type: "number", description: "결과 수 (기본값: 5)" },
      },
      required: ["query"],
    },
  },
  {
    name: "read_note",
    description: "특정 노트의 전체 내용을 읽습니다.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "노트 파일 경로 (예: folder/note.md)" },
      },
      required: ["path"],
    },
  },
  {
    name: "create_note",
    description: "새 노트를 생성합니다.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "생성할 파일 경로" },
        content: { type: "string", description: "노트 내용 (마크다운)" },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "edit_note",
    description: "기존 노트의 내용을 수정합니다.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "수정할 파일 경로" },
        content: { type: "string", description: "새 내용" },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "append_to_note",
    description: "기존 노트 끝에 내용을 추가합니다.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "파일 경로" },
        content: { type: "string", description: "추가할 내용" },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "list_files",
    description: "볼트의 파일/폴더 목록을 반환합니다.",
    input_schema: {
      type: "object",
      properties: {
        folder: { type: "string", description: "폴더 경로 (비어있으면 루트)" },
      },
    },
  },
  {
    name: "get_active_note",
    description: "현재 열려있는 노트의 경로와 내용을 반환합니다.",
    input_schema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "open_note",
    description: "특정 노트를 에디터에서 엽니다.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "열 파일 경로" },
      },
      required: ["path"],
    },
  },
];

// 도구 실행기
export class ToolExecutor {
  private app: App;
  private indexer: VaultIndexer;

  constructor(app: App, indexer: VaultIndexer) {
    this.app = app;
    this.indexer = indexer;
  }

  async execute(toolName: string, input: Record<string, unknown>): Promise<string> {
    try {
      switch (toolName) {
        case "search_vault":
          return await this.searchVault(input.query as string, (input.limit as number) || 5);
        case "read_note":
          return await this.readNote(input.path as string);
        case "create_note":
          return await this.createNote(input.path as string, input.content as string);
        case "edit_note":
          return await this.editNote(input.path as string, input.content as string);
        case "append_to_note":
          return await this.appendToNote(input.path as string, input.content as string);
        case "list_files":
          return this.listFiles((input.folder as string) || "");
        case "get_active_note":
          return this.getActiveNote();
        case "open_note":
          return await this.openNote(input.path as string);
        default:
          return `알 수 없는 도구: ${toolName}`;
      }
    } catch (error) {
      return `도구 실행 오류 (${toolName}): ${(error as Error).message}`;
    }
  }

  private async searchVault(query: string, limit: number): Promise<string> {
    const results = await this.indexer.search(query, limit);
    if (results.length === 0) {
      return "검색 결과가 없습니다. 볼트 인덱싱이 필요할 수 있습니다.";
    }
    return results
      .map((r, i) => `${i + 1}. **${r.title}** (${r.path})\n   유사도: ${(r.score * 100).toFixed(1)}%\n   ${r.excerpt.slice(0, 200)}...`)
      .join("\n\n");
  }

  private async readNote(path: string): Promise<string> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!file || !(file instanceof TFile)) {
      return `파일을 찾을 수 없습니다: ${path}`;
    }
    const content = await this.app.vault.cachedRead(file);
    return `# ${file.basename}\n\n${content}`;
  }

  private async createNote(path: string, content: string): Promise<string> {
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing) {
      return `파일이 이미 존재합니다: ${path}`;
    }
    await this.app.vault.create(path, content);
    new Notice(`노트 생성됨: ${path}`);
    return `노트가 생성되었습니다: ${path}`;
  }

  private async editNote(path: string, content: string): Promise<string> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!file || !(file instanceof TFile)) {
      return `파일을 찾을 수 없습니다: ${path}`;
    }
    await this.app.vault.modify(file, content);
    new Notice(`노트 수정됨: ${path}`);
    return `노트가 수정되었습니다: ${path}`;
  }

  private async appendToNote(path: string, content: string): Promise<string> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!file || !(file instanceof TFile)) {
      return `파일을 찾을 수 없습니다: ${path}`;
    }
    await this.app.vault.append(file, "\n" + content);
    new Notice(`내용 추가됨: ${path}`);
    return `내용이 추가되었습니다: ${path}`;
  }

  private listFiles(folder: string): string {
    const root = folder
      ? this.app.vault.getAbstractFileByPath(folder)
      : this.app.vault.getRoot();

    if (!root || !(root instanceof TFolder)) {
      return `폴더를 찾을 수 없습니다: ${folder}`;
    }

    const items: string[] = [];
    for (const child of root.children) {
      const icon = child instanceof TFolder ? "📁" : "📄";
      items.push(`${icon} ${child.name}`);
    }
    return items.length > 0 ? items.join("\n") : "빈 폴더입니다.";
  }

  private getActiveNote(): string {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view || !view.file) {
      return "현재 열려있는 노트가 없습니다.";
    }
    const content = view.editor.getValue();
    return `경로: ${view.file.path}\n\n${content}`;
  }

  private async openNote(path: string): Promise<string> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!file || !(file instanceof TFile)) {
      return `파일을 찾을 수 없습니다: ${path}`;
    }
    await this.app.workspace.getLeaf(false).openFile(file);
    return `노트를 열었습니다: ${path}`;
  }
}
