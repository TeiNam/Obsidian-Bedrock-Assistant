import { App, TFile, TFolder, normalizePath } from "obsidian";

export const AI_CHANGE_LEDGER_LIMIT = 20;

export type AiPathSnapshot =
  | { path: string; kind: "missing" }
  | { path: string; kind: "file"; data: string }
  | { path: string; kind: "folder"; children: AiPathSnapshot[] };

export interface AiChangeRecord {
  id: string;
  label: string;
  createdAt: number;
  before: AiPathSnapshot[];
  after: AiPathSnapshot[];
}

export interface UndoResult {
  ok: boolean;
  reason?: "empty" | "conflict";
  record?: AiChangeRecord;
}

function isSafeVaultPath(path: string): boolean {
  return (
    path !== "" &&
    !path.startsWith("/") &&
    !path.split("/").some((part) => part === ".." || part === "")
  );
}

function isSnapshot(value: unknown, parent?: string): value is AiPathSnapshot {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  if (typeof item.path !== "string" || !isSafeVaultPath(item.path)) return false;
  if (parent !== undefined && !item.path.startsWith(`${parent}/`)) return false;
  if (item.kind === "missing") return true;
  if (item.kind === "file") return typeof item.data === "string";
  return (
    item.kind === "folder" &&
    Array.isArray(item.children) &&
    item.children.every((child) => isSnapshot(child, item.path as string))
  );
}

/** unknown 이 스냅샷 배열인지 확인한다(Array.isArray 만으로는 원소 타입이 any 로 남는다). */
function isSnapshotArray(value: unknown): value is AiPathSnapshot[] {
  return Array.isArray(value) && value.every((item) => isSnapshot(item));
}

function isRecord(value: unknown): value is AiChangeRecord {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  if (
    typeof item.id !== "string" ||
    typeof item.label !== "string" ||
    typeof item.createdAt !== "number" ||
    !isSnapshotArray(item.before) ||
    !isSnapshotArray(item.after)
  ) {
    return false;
  }
  const beforePaths = item.before.map((snapshot) => snapshot.path).sort();
  const afterPaths = item.after.map((snapshot) => snapshot.path).sort();
  return JSON.stringify(beforePaths) === JSON.stringify(afterPaths);
}

function uniqueRoots(paths: readonly string[]): string[] {
  const normalized = [...new Set(paths.map((path) => normalizePath(path.trim())))]
    .filter(isSafeVaultPath)
    .sort((a, b) => a.length - b.length || a.localeCompare(b));
  return normalized.filter(
    (path, index) =>
      !normalized.slice(0, index).some((parent) => path.startsWith(`${parent}/`))
  );
}

async function snapshotPath(app: App, path: string): Promise<AiPathSnapshot> {
  const target = app.vault.getAbstractFileByPath(path);
  if (target instanceof TFile) {
    const data = await app.vault.readBinary(target);
    return { path, kind: "file", data: Buffer.from(data).toString("base64") };
  }
  if (target instanceof TFolder) {
    const children = await Promise.all(
      [...target.children]
        .sort((a, b) => a.path.localeCompare(b.path))
        .map((child) => snapshotPath(app, child.path))
    );
    return { path, kind: "folder", children };
  }
  return { path, kind: "missing" };
}

async function ensureFolder(app: App, path: string): Promise<void> {
  const parts = path.split("/").filter(Boolean);
  let current = "";
  for (const part of parts) {
    current = current === "" ? part : `${current}/${part}`;
    if (!app.vault.getAbstractFileByPath(current)) await app.vault.createFolder(current);
  }
}

async function restoreSnapshot(app: App, snapshot: AiPathSnapshot): Promise<void> {
  if (snapshot.kind === "missing") return;
  const slash = snapshot.path.lastIndexOf("/");
  if (slash > 0) await ensureFolder(app, snapshot.path.slice(0, slash));

  if (snapshot.kind === "file") {
    const bytes = Buffer.from(snapshot.data, "base64");
    await app.vault.createBinary(
      snapshot.path,
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    );
    return;
  }

  if (!app.vault.getAbstractFileByPath(snapshot.path)) {
    await app.vault.createFolder(snapshot.path);
  }
  for (const child of snapshot.children) await restoreSnapshot(app, child);
}

function sameSnapshots(a: readonly AiPathSnapshot[], b: readonly AiPathSnapshot[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * AI가 수행한 파일 작업의 전후 스냅샷을 최근 20건만 보관한다.
 *
 * 되돌리기 전에 현재 상태가 기록된 after와 같은지 확인한다. 이후 사용자 편집이 있으면
 * 중단하여 오래된 스냅샷으로 덮어쓰지 않는다.
 */
export class AiChangeLedger {
  private records: AiChangeRecord[] = [];

  constructor(
    private app: App,
    private storagePath: string,
  ) {}

  async load(): Promise<void> {
    try {
      if (!(await this.app.vault.adapter.exists(this.storagePath))) return;
      const parsed: unknown = JSON.parse(await this.app.vault.adapter.read(this.storagePath));
      this.records = Array.isArray(parsed)
        ? parsed.filter(isRecord).slice(-AI_CHANGE_LEDGER_LIMIT)
        : [];
    } catch (error) {
      console.error("AI 변경 원장 로드 실패:", error);
      this.records = [];
    }
  }

  list(): readonly AiChangeRecord[] {
    return [...this.records].reverse();
  }

  async run<T>(label: string, paths: readonly string[], action: () => Promise<T>): Promise<T> {
    const roots = uniqueRoots(paths);
    if (roots.length === 0) return action();

    const before = await Promise.all(roots.map((path) => snapshotPath(this.app, path)));
    try {
      return await action();
    } finally {
      // 작업이 실패해도 부분 변경은 남을 수 있으므로 성공 여부와 무관하게 원장에 기록한다.
      // finally 로 두면 원래 예외가 그대로 호출부로 올라간다.
      const after = await Promise.all(roots.map((path) => snapshotPath(this.app, path)));
      if (!sameSnapshots(before, after)) {
        this.records.push({
          id: window.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
          label,
          createdAt: Date.now(),
          before,
          after,
        });
        this.records = this.records.slice(-AI_CHANGE_LEDGER_LIMIT);
        await this.persist();
      }
    }
  }

  async undoLast(): Promise<UndoResult> {
    const record = this.records.at(-1);
    if (!record) return { ok: false, reason: "empty" };

    const current = await Promise.all(record.after.map((item) => snapshotPath(this.app, item.path)));
    if (!sameSnapshots(current, record.after)) {
      return { ok: false, reason: "conflict", record };
    }

    // 겹치는 경로는 저장 시 제거되므로 각 루트를 현재 상태에서 지운 뒤 before를 복원하면 된다.
    for (const snapshot of [...record.after].sort((a, b) => b.path.length - a.path.length)) {
      const target = this.app.vault.getAbstractFileByPath(snapshot.path);
      if (target) await this.app.fileManager.trashFile(target);
    }
    for (const snapshot of record.before) await restoreSnapshot(this.app, snapshot);

    this.records.pop();
    await this.persist();
    return { ok: true, record };
  }

  private async persist(): Promise<void> {
    await this.app.vault.adapter.write(this.storagePath, JSON.stringify(this.records));
  }
}
