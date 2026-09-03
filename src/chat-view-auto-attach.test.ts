import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => {
  class Component {}
  class ItemView extends Component {}
  class Modal {}
  class FuzzySuggestModal<T> extends Modal {}
  class TFile {
    path = "";
    name = "";
    basename = "";
    extension = "";
  }

  return {
    App: class {},
    Component,
    FuzzySuggestModal,
    ItemView,
    MarkdownRenderer: {},
    MarkdownView: class {},
    Modal,
    Notice: class {},
    TFile,
    WorkspaceLeaf: class {},
    normalizePath: (path: string) => path,
    requestUrl: vi.fn(),
    setIcon: vi.fn(),
  };
});

import { TFile } from "obsidian";
import { ChatView } from "./chat-view";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function markdownFile(path: string): TFile {
  const file = new TFile();
  file.path = path;
  file.name = path;
  file.basename = path.replace(/\.md$/, "");
  file.extension = "md";
  return file;
}

describe("ChatView 자동 첨부", () => {
  it("늦게 끝난 이전 노트 읽기가 현재 노트를 다시 덮어쓰지 않는다", async () => {
    const files = new Map([
      ["A.md", markdownFile("A.md")],
      ["B.md", markdownFile("B.md")],
    ]);
    const reads = new Map([
      ["A.md", deferred<string>()],
      ["B.md", deferred<string>()],
    ]);
    const view = Object.create(ChatView.prototype) as any;
    Object.assign(view, {
      app: {
        vault: {
          getAbstractFileByPath: (path: string) => files.get(path) ?? null,
          cachedRead: (file: TFile) => reads.get(file.path)!.promise,
        },
      },
      attachedFiles: new Map(),
      attachedBinaryFiles: new Map(),
      manuallyAttachedPaths: new Set(),
      autoAttachedPath: null,
      autoAttachVersion: 0,
      renderFileChips: vi.fn(),
    });

    const first = view.autoAttachFile("A.md");
    const second = view.autoAttachFile("B.md");
    reads.get("B.md")!.resolve("B 내용");
    await second;
    reads.get("A.md")!.resolve("A 내용");
    await first;

    expect([...view.attachedFiles.entries()]).toEqual([["B.md", "B 내용"]]);
    expect(view.autoAttachedPath).toBe("B.md");
  });
});
