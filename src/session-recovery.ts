// 세션 파일 손상 복구 유틸리티
// Vault API 의존성을 추상화하여 테스트 가능하게 분리

import type { ChatSession } from "./types";

/**
 * 파일 읽기/쓰기를 위한 추상 인터페이스
 * Obsidian Vault API를 추상화하여 테스트 가능하게 함
 */
export interface FileAdapter {
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<string>;
  write(path: string, data: string): Promise<void>;
  create(path: string, data: string): Promise<void>;
}

export interface RecoveryResult {
  sessions: ChatSession[];
  recovered: boolean;
  error: boolean;
}

/**
 * 세션 파일을 로드하고, 파싱 실패 시 백업에서 복구를 시도하는 함수
 */
export async function loadSessionsWithRecovery(
  adapter: FileAdapter,
  sessionsPath: string,
  backupPath: string,
): Promise<RecoveryResult> {
  // 원본 파일 로드 시도
  try {
    const exists = await adapter.exists(sessionsPath);
    if (exists) {
      const data = await adapter.read(sessionsPath);
      const sessions = JSON.parse(data) as ChatSession[];
      return { sessions, recovered: false, error: false };
    }
  } catch {
    // 파싱 실패 시 백업에서 복구 시도
    try {
      const bakExists = await adapter.exists(backupPath);
      if (bakExists) {
        const bakData = await adapter.read(backupPath);
        const sessions = JSON.parse(bakData) as ChatSession[];
        // 복구 성공: 원본 파일을 백업 데이터로 복원
        try {
          await adapter.write(sessionsPath, bakData);
        } catch {
          // 원본 복원 실패는 무시 (세션 데이터는 이미 복구됨)
        }
        return { sessions, recovered: true, error: false };
      }
    } catch {
      // 백업 복구도 실패
    }
    return { sessions: [], recovered: false, error: true };
  }
  return { sessions: [], recovered: false, error: false };
}

/**
 * 세션 저장 전 기존 파일을 백업하는 함수
 */
export async function saveSessionsWithBackup(
  adapter: FileAdapter,
  sessions: ChatSession[],
  sessionsPath: string,
  backupPath: string,
): Promise<void> {
  // 기존 파일이 있으면 백업 생성
  const exists = await adapter.exists(sessionsPath);
  if (exists) {
    try {
      const existingData = await adapter.read(sessionsPath);
      const bakExists = await adapter.exists(backupPath);
      if (bakExists) {
        await adapter.write(backupPath, existingData);
      } else {
        await adapter.create(backupPath, existingData);
      }
    } catch {
      // 백업 생성 실패는 저장을 중단하지 않음
      console.warn("세션 백업 파일 생성 실패");
    }
  }

  // 세션 데이터 저장
  const data = JSON.stringify(sessions);
  if (exists) {
    await adapter.write(sessionsPath, data);
  } else {
    await adapter.create(sessionsPath, data);
  }
}
