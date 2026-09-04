import { describe, expect, it } from "vitest";
import { TFile, TFolder } from "obsidian";
import { AI_CHANGE_LEDGER_LIMIT, AiChangeLedger } from "./ai-change-ledger";

function makeApp(initial: Record<string, string> = {}) {
  const files = new Map<string, Uint8Array>(
    Object.entries(initial).map(([path, text]) => [path, Buffer.from(text)])
  );
  const folders = new Set<string>();
  const storage = new Map<string, string>();

  const addParents = (path: string) => {
    const parts = path.split("/");
    parts.pop();
    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      folders.add(current);
    }
  };
  for (const path of files.keys()) addParents(path);

  const getAbstractFileByPath = (path: string): TFile | TFolder | null => {
    if (files.has(path)) {
      const file = new TFile();
      file.path = path;
      file.basename = path.split("/").pop()?.replace(/\.[^.]+$/, "") ?? path;
      return file;
    }
    if (folders.has(path)) {
      const folder = new TFolder();
      folder.path = path;
      folder.children = [
        ...[...folders]
          .filter((child) => child.startsWith(`${path}/`) && !child.slice(path.length + 1).includes("/"))
          .map((child) => getAbstractFileByPath(child) as TFolder),
        ...[...files.keys()]
          .filter((child) => child.startsWith(`${path}/`) && !child.slice(path.length + 1).includes("/"))
          .map((child) => getAbstractFileByPath(child) as TFile),
      ];
      return folder;
    }
    return null;
  };

  const remove = (path: string) => {
    files.delete(path);
    for (const file of [...files.keys()]) if (file.startsWith(`${path}/`)) files.delete(file);
    folders.delete(path);
    for (const folder of [...folders]) if (folder.startsWith(`${path}/`)) folders.delete(folder);
  };

  const app = {
    vault: {
      adapter: {
        exists: async (path: string) => storage.has(path),
        read: async (path: string) => storage.get(path) ?? "",
        write: async (path: string, data: string) => {
          storage.set(path, data);
        },
      },
      getAbstractFileByPath,
      readBinary: async (file: TFile) => {
        const bytes = files.get(file.path) ?? new Uint8Array();
        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      },
      createBinary: async (path: string, data: ArrayBuffer) => {
        addParents(path);
        files.set(path, new Uint8Array(data));
        return getAbstractFileByPath(path);
      },
      createFolder: async (path: string) => {
        addParents(`${path}/x`);
        folders.add(path);
      },
      delete: async (target: TFile | TFolder) => remove(target.path),
    },
  } as any;

  return {
    app,
    text: (path: string) => Buffer.from(files.get(path) ?? []).toString(),
    write: (path: string, text: string) => {
      addParents(path);
      files.set(path, Buffer.from(text));
    },
    exists: (path: string) => files.has(path) || folders.has(path),
  };
}

describe("AiChangeLedger", () => {
  it("수정 작업을 기록하고 마지막 상태를 원복한다", async () => {
    const fs = makeApp({ "note.md": "before" });
    const ledger = new AiChangeLedger(fs.app, ".ledger.json");

    await ledger.run("edit_note", ["note.md"], async () => fs.write("note.md", "after"));
    expect(ledger.list()).toHaveLength(1);

    expect((await ledger.undoLast()).ok).toBe(true);
    expect(fs.text("note.md")).toBe("before");
    expect(ledger.list()).toHaveLength(0);
  });

  it("생성된 파일은 되돌릴 때 제거한다", async () => {
    const fs = makeApp();
    const ledger = new AiChangeLedger(fs.app, ".ledger.json");

    await ledger.run("create_note", ["new.md"], async () => fs.write("new.md", "new"));
    await ledger.undoLast();

    expect(fs.exists("new.md")).toBe(false);
  });

  it("작업 뒤 사용자가 다시 편집했으면 덮어쓰지 않는다", async () => {
    const fs = makeApp({ "note.md": "before" });
    const ledger = new AiChangeLedger(fs.app, ".ledger.json");

    await ledger.run("edit_note", ["note.md"], async () => fs.write("note.md", "after"));
    fs.write("note.md", "user edit");

    expect(await ledger.undoLast()).toMatchObject({ ok: false, reason: "conflict" });
    expect(fs.text("note.md")).toBe("user edit");
  });

  it("최근 20건만 유지한다", async () => {
    const fs = makeApp({ "note.md": "0" });
    const ledger = new AiChangeLedger(fs.app, ".ledger.json");

    for (let i = 1; i <= AI_CHANGE_LEDGER_LIMIT + 3; i++) {
      await ledger.run(`edit ${i}`, ["note.md"], async () => fs.write("note.md", String(i)));
    }

    expect(ledger.list()).toHaveLength(AI_CHANGE_LEDGER_LIMIT);
    expect(ledger.list().at(-1)?.label).toBe("edit 4");
  });
});
