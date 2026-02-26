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
  {
    name: "list_templates",
    description: "설정된 템플릿 폴더에서 사용 가능한 템플릿 목록을 반환합니다.",
    input_schema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "save_template",
    description: "새 템플릿을 생성하여 템플릿 폴더에 저장합니다. 사용자가 원하는 양식을 자연어로 설명하면 마크다운 템플릿을 만들어 저장합니다. 템플릿에는 {{placeholder}} 형식의 치환 변수를 사용하세요.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "템플릿 파일명 (.md 확장자 제외)" },
        content: { type: "string", description: "템플릿 내용 (마크다운). {{변수명}} 형식으로 치환할 부분을 표시" },
      },
      required: ["name", "content"],
    },
  },
  {
    name: "apply_template",
    description: "기존 템플릿을 불러와서 내용을 채워 새 노트를 생성합니다. 템플릿의 {{placeholder}}를 실제 값으로 치환합니다.",
    input_schema: {
      type: "object",
      properties: {
        template_name: { type: "string", description: "사용할 템플릿 파일명 (.md 확장자 제외)" },
        output_path: { type: "string", description: "생성할 노트 경로 (예: folder/note.md)" },
        variables: {
          type: "object",
          description: "템플릿 변수 치환 맵 (예: {\"제목\": \"회의록\", \"날짜\": \"2025-01-01\"})",
        },
      },
      required: ["template_name", "output_path"],
    },
  },
  {
    name: "move_file",
    description: "파일 또는 폴더를 다른 위치로 이동하거나 이름을 변경합니다. 대상 폴더가 없으면 자동으로 생성합니다.",
    input_schema: {
      type: "object",
      properties: {
        source_path: { type: "string", description: "이동할 파일/폴더의 현재 경로 (예: inbox/note.md)" },
        destination_path: { type: "string", description: "이동할 목적지 경로 (예: Projects/note.md)" },
      },
      required: ["source_path", "destination_path"],
    },
  },
];

// 도구 실행기
export class ToolExecutor {
  private app: App;
  private indexer: VaultIndexer;
  private getTemplateFolder: () => string;

  constructor(app: App, indexer: VaultIndexer, getTemplateFolder: () => string) {
    this.app = app;
    this.indexer = indexer;
    this.getTemplateFolder = getTemplateFolder;
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
        case "list_templates":
          return this.listTemplates();
        case "save_template":
          return await this.saveTemplate(input.name as string, input.content as string);
        case "apply_template":
          return await this.applyTemplate(
            input.template_name as string,
            input.output_path as string,
            (input.variables as Record<string, string>) || {}
          );
        case "move_file":
          return await this.moveFile(
            input.source_path as string,
            input.destination_path as string
          );
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

  // 템플릿 폴더가 존재하는지 확인하고, 없으면 생성
  private async ensureTemplateFolder(): Promise<string> {
    const folder = this.getTemplateFolder();
    const existing = this.app.vault.getAbstractFileByPath(folder);
    if (!existing) {
      await this.app.vault.createFolder(folder);
    }
    return folder;
  }

  private listTemplates(): string {
    const folder = this.getTemplateFolder();
    const root = this.app.vault.getAbstractFileByPath(folder);
    if (!root || !(root instanceof TFolder)) {
      return `템플릿 폴더가 없습니다: ${folder}\n템플릿을 저장하면 자동으로 생성됩니다.`;
    }

    const templates = root.children
      .filter((f): f is TFile => f instanceof TFile && f.extension === "md")
      .sort((a, b) => a.basename.localeCompare(b.basename));

    if (templates.length === 0) {
      return "저장된 템플릿이 없습니다.";
    }

    return templates
      .map((f, i) => `${i + 1}. 📋 ${f.basename}`)
      .join("\n");
  }

  private async saveTemplate(name: string, content: string): Promise<string> {
    const folder = await this.ensureTemplateFolder();
    const path = `${folder}/${name}.md`;

    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing && existing instanceof TFile) {
      // 기존 템플릿 덮어쓰기
      await this.app.vault.modify(existing, content);
      new Notice(`템플릿 수정됨: ${name}`);
      return `템플릿이 수정되었습니다: ${path}`;
    }

    await this.app.vault.create(path, content);
    new Notice(`템플릿 생성됨: ${name}`);
    return `템플릿이 저장되었습니다: ${path}`;
  }

  private async applyTemplate(
    templateName: string,
    outputPath: string,
    variables: Record<string, string>
  ): Promise<string> {
    const folder = this.getTemplateFolder();
    const templatePath = `${folder}/${templateName}.md`;

    const templateFile = this.app.vault.getAbstractFileByPath(templatePath);
    if (!templateFile || !(templateFile instanceof TFile)) {
      return `템플릿을 찾을 수 없습니다: ${templateName}\n사용 가능한 템플릿을 확인하려면 list_templates를 사용하세요.`;
    }

    let content = await this.app.vault.cachedRead(templateFile);

    // {{변수명}} 치환
    for (const [key, value] of Object.entries(variables)) {
      content = content.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value);
    }

    // 출력 파일 생성
    const existing = this.app.vault.getAbstractFileByPath(outputPath);
    if (existing) {
      return `파일이 이미 존재합니다: ${outputPath}`;
    }

    // 출력 경로의 상위 폴더 확인/생성
    const outputDir = outputPath.substring(0, outputPath.lastIndexOf("/"));
    if (outputDir) {
      const dirExists = this.app.vault.getAbstractFileByPath(outputDir);
      if (!dirExists) {
        await this.app.vault.createFolder(outputDir);
      }
    }

    await this.app.vault.create(outputPath, content);

    // 생성된 노트 열기
    const newFile = this.app.vault.getAbstractFileByPath(outputPath);
    if (newFile && newFile instanceof TFile) {
      await this.app.workspace.getLeaf(false).openFile(newFile);
    }

    new Notice(`템플릿 적용됨: ${outputPath}`);

    // 남은 미치환 변수 확인
    const remaining = content.match(/\{\{[^}]+\}\}/g);
    if (remaining) {
      return `노트가 생성되었습니다: ${outputPath}\n⚠️ 미치환 변수가 남아있습니다: ${remaining.join(", ")}`;
    }
    return `노트가 생성되었습니다: ${outputPath}`;
  }

  private async moveFile(sourcePath: string, destPath: string): Promise<string> {
    const source = this.app.vault.getAbstractFileByPath(sourcePath);
    if (!source) {
      return `파일/폴더를 찾을 수 없습니다: ${sourcePath}`;
    }

    // 대상 경로에 이미 파일이 존재하는지 확인
    const existing = this.app.vault.getAbstractFileByPath(destPath);
    if (existing) {
      return `대상 경로에 이미 파일이 존재합니다: ${destPath}`;
    }

    // 대상 폴더가 없으면 자동 생성
    const destDir = destPath.substring(0, destPath.lastIndexOf("/"));
    if (destDir) {
      const dirExists = this.app.vault.getAbstractFileByPath(destDir);
      if (!dirExists) {
        await this.app.vault.createFolder(destDir);
      }
    }

    await this.app.vault.rename(source, destPath);
    const type = source instanceof TFolder ? "폴더" : "파일";
    new Notice(`${type} 이동됨: ${destPath}`);
    return `${type}을(를) 이동했습니다: ${sourcePath} → ${destPath}`;
  }
}
