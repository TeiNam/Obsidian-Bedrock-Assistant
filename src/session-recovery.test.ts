import { describe, it, expect, vi } from "vitest";
import {
  loadSessionsWithRecovery,
  saveSessionsWithBackup,
  type FileAdapter,
} from "./session-recovery";
import type { ChatSession } from "./types";

// 테스트용 세션 데이터 생성 헬퍼
function createTestSession(id: string, title: string): ChatSession {
  return {
    id,
    title,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: [{ role: "user", content: "테스트 메시지", timestamp: Date.now() }],
  };
}

// 인메모리 파일 어댑터 (테스트용)
function createMockAdapter(files: Record<string, string> = {}): FileAdapter {
  const store = { ...files };
  return {
    exists: async (path: string) => path in store,
    read: async (path: string) => {
      if (!(path in store)) throw new Error("파일 없음");
      return store[path];
    },
    write: async (path: string, data: string) => {
      store[path] = data;
    },
    create: async (path: string, data: string) => {
      store[path] = data;
    },
  };
}

const SESSIONS_PATH = "sessions.json";
const BACKUP_PATH = "sessions.json.bak";

describe("세션 파일 손상 복구", () => {
  describe("loadSessionsWithRecovery", () => {
    it("정상 세션 파일을 로드한다", async () => {
      const sessions = [createTestSession("s1", "세션1")];
      const adapter = createMockAdapter({
        [SESSIONS_PATH]: JSON.stringify(sessions),
      });

      const result = await loadSessionsWithRecovery(adapter, SESSIONS_PATH, BACKUP_PATH);

      expect(result.sessions).toHaveLength(1);
      expect(result.sessions[0].title).toBe("세션1");
      expect(result.recovered).toBe(false);
      expect(result.error).toBe(false);
    });

    it("세션 파일이 없으면 빈 배열을 반환한다", async () => {
      const adapter = createMockAdapter({});

      const result = await loadSessionsWithRecovery(adapter, SESSIONS_PATH, BACKUP_PATH);

      expect(result.sessions).toEqual([]);
      expect(result.recovered).toBe(false);
      expect(result.error).toBe(false);
    });

    it("손상된 세션 파일을 백업에서 복구한다", async () => {
      const sessions = [createTestSession("s1", "복구된 세션")];
      const adapter = createMockAdapter({
        [SESSIONS_PATH]: "{ 손상된 JSON 데이터 !!!",
        [BACKUP_PATH]: JSON.stringify(sessions),
      });

      const result = await loadSessionsWithRecovery(adapter, SESSIONS_PATH, BACKUP_PATH);

      expect(result.sessions).toHaveLength(1);
      expect(result.sessions[0].title).toBe("복구된 세션");
      expect(result.recovered).toBe(true);
      expect(result.error).toBe(false);
    });

    it("복구 성공 시 원본 파일을 백업 데이터로 복원한다", async () => {
      const sessions = [createTestSession("s1", "복구됨")];
      const bakData = JSON.stringify(sessions);
      const adapter = createMockAdapter({
        [SESSIONS_PATH]: "손상된 데이터",
        [BACKUP_PATH]: bakData,
      });

      await loadSessionsWithRecovery(adapter, SESSIONS_PATH, BACKUP_PATH);

      // 원본 파일이 백업 데이터로 복원되었는지 확인
      const restoredData = await adapter.read(SESSIONS_PATH);
      expect(restoredData).toBe(bakData);
    });

    it("세션 파일과 백업 모두 손상되면 에러를 반환한다", async () => {
      const adapter = createMockAdapter({
        [SESSIONS_PATH]: "손상된 원본",
        [BACKUP_PATH]: "손상된 백업",
      });

      const result = await loadSessionsWithRecovery(adapter, SESSIONS_PATH, BACKUP_PATH);

      expect(result.sessions).toEqual([]);
      expect(result.recovered).toBe(false);
      expect(result.error).toBe(true);
    });

    it("세션 파일 손상 + 백업 없음이면 에러를 반환한다", async () => {
      const adapter = createMockAdapter({
        [SESSIONS_PATH]: "손상된 데이터",
      });

      const result = await loadSessionsWithRecovery(adapter, SESSIONS_PATH, BACKUP_PATH);

      expect(result.sessions).toEqual([]);
      expect(result.recovered).toBe(false);
      expect(result.error).toBe(true);
    });
  });

  describe("saveSessionsWithBackup", () => {
    it("새 파일로 세션을 저장한다 (기존 파일 없음)", async () => {
      const sessions = [createTestSession("s1", "새 세션")];
      const adapter = createMockAdapter({});

      await saveSessionsWithBackup(adapter, sessions, SESSIONS_PATH, BACKUP_PATH);

      const saved = await adapter.read(SESSIONS_PATH);
      expect(JSON.parse(saved)).toHaveLength(1);
      // 백업은 생성되지 않아야 함
      expect(await adapter.exists(BACKUP_PATH)).toBe(false);
    });

    it("기존 파일이 있으면 백업을 생성한 후 저장한다", async () => {
      const oldSessions = [createTestSession("s1", "이전 세션")];
      const newSessions = [createTestSession("s2", "새 세션")];
      const adapter = createMockAdapter({
        [SESSIONS_PATH]: JSON.stringify(oldSessions),
      });

      await saveSessionsWithBackup(adapter, newSessions, SESSIONS_PATH, BACKUP_PATH);

      // 백업에 이전 데이터가 저장되었는지 확인
      const bakData = await adapter.read(BACKUP_PATH);
      const bakSessions = JSON.parse(bakData);
      expect(bakSessions[0].title).toBe("이전 세션");

      // 원본에 새 데이터가 저장되었는지 확인
      const savedData = await adapter.read(SESSIONS_PATH);
      const savedSessions = JSON.parse(savedData);
      expect(savedSessions[0].title).toBe("새 세션");
    });

    it("백업 생성 실패해도 세션 저장은 진행된다", async () => {
      const sessions = [createTestSession("s1", "세션")];
      const adapter = createMockAdapter({
        [SESSIONS_PATH]: JSON.stringify([]),
      });
      // 백업 쓰기를 실패하도록 설정
      const origWrite = adapter.write;
      let callCount = 0;
      adapter.write = async (path: string, data: string) => {
        callCount++;
        if (callCount === 1 && path === BACKUP_PATH) {
          throw new Error("백업 쓰기 실패");
        }
        return origWrite(path, data);
      };

      await saveSessionsWithBackup(adapter, sessions, SESSIONS_PATH, BACKUP_PATH);

      // 세션은 정상 저장되어야 함
      const saved = await adapter.read(SESSIONS_PATH);
      expect(JSON.parse(saved)).toHaveLength(1);
    });
  });
});
