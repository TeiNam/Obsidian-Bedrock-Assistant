import { describe, expect, it, vi } from "vitest";
import { TFile } from "obsidian";
import { VaultIndexer } from "./vault-indexer";

function file(path: string, content: string, mtime = 1000): TFile {
  const value = new TFile();
  value.path = path;
  value.name = path.split("/").pop() ?? path;
  value.basename = value.name.replace(/\.[^.]+$/, "");
  value.extension = value.name.includes(".") ? value.name.split(".").pop()! : "";
  value.stat = {
    mtime,
    ctime: mtime,
    size: new TextEncoder().encode(content).length,
  } as TFile["stat"];
  return value;
}

describe("첨부파일 영구 RAG", () => {
  it("TXT·CSV·JSON·HTML을 인덱싱하고 바이너리는 제외한다", async () => {
    const contents = new Map([
      ["note.md", "# 노트\n마크다운"],
      ["memo.txt", "일반 텍스트"],
      ["table.csv", "name,value\nalpha,42"],
      ["data.json", '{"project":"orion"}'],
      [
        "page.html",
        "<html><head><style>.x{display:none}</style><script>secretScript()</script></head><body><h1>문서</h1><p>검색 가능한 HTML</p></body></html>",
      ],
      ["image.png", "not really text"],
      [
        "Second Brain/Agent LLMs Dashboard Items/review-deadbeef.md",
        "---\nagent_llms_dashboard: true\n---\n생성 투영",
      ],
    ]);
    const files = [...contents].map(([path, content]) => file(path, content));
    const app = {
      vault: {
        getFiles: () => files,
        getMarkdownFiles: () => files.filter((f) => f.extension === "md"),
        cachedRead: async (target: TFile) => contents.get(target.path) ?? "",
        getAbstractFileByPath: (path: string) => files.find((f) => f.path === path) ?? null,
      },
    } as unknown as ConstructorParameters<typeof VaultIndexer>[0];
    const client = {
      getEmbedding: vi.fn(async () => [0.1, 0.2, 0.3]),
    } as unknown as ConstructorParameters<typeof VaultIndexer>[1];
    const indexer = new VaultIndexer(app, client);

    await indexer.indexVault();

    const entries = new Map(indexer.getEntries().map((entry) => [entry.path, entry]));
    expect([...entries.keys()].sort()).toEqual([
      "data.json",
      "memo.txt",
      "note.md",
      "page.html",
      "table.csv",
    ]);
    expect(entries.get("page.html")?.searchText).toContain("검색 가능한 html");
    expect(entries.get("page.html")?.searchText).not.toContain("secretscript");
    expect(entries.get("page.html")?.searchText).not.toContain("<h1>");
    expect(entries.get("page.html")?.chunks?.every((chunk) => chunk.heading === undefined)).toBe(true);
    expect(entries.get("data.json")?.frontmatter).toEqual({});
    expect(
      entries.has("Second Brain/Agent LLMs Dashboard Items/review-deadbeef.md"),
    ).toBe(false);
  });

  it("첨부파일 수정·삭제를 증분 인덱스에 반영한다", async () => {
    const target = file("memo.txt", "이전 내용");
    let content = "이전 내용";
    const app = {
      vault: {
        getMarkdownFiles: () => [],
        cachedRead: async () => content,
        getAbstractFileByPath: () => target,
      },
    } as unknown as ConstructorParameters<typeof VaultIndexer>[0];
    const client = {
      getEmbedding: vi.fn(async () => [0.1, 0.2, 0.3]),
    } as unknown as ConstructorParameters<typeof VaultIndexer>[1];
    const indexer = new VaultIndexer(app, client);

    await indexer.indexFile(target);
    content = "새 내용";
    target.stat = { ...target.stat, mtime: 2000 } as TFile["stat"];
    await indexer.indexFile(target);
    expect(indexer.getEntries()[0].searchText).toContain("새 내용");

    indexer.removeFile(target.path);
    expect(indexer.getEntries()).toEqual([]);
  });
});
