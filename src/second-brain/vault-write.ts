// ============================================
// 볼트 쓰기 — 원자적이면서 no-op은 건너뛴다
// ============================================
// Second Brain의 노트 갱신은 두 성질을 동시에 요구한다.
//
//  1. **원자성**: 사용자가 같은 노트를 편집하는 중에 스케줄러가 돌 수 있다.
//     read → modify 왕복은 읽은 뒤 쓰기 전에 들어온 사용자 편집을 덮어쓴다.
//     자동 스케줄러가 앱 시작 시 한 번만 돌 때는 겹칠 확률이 낮았지만, 30분 주기 tick이
//     붙은 뒤로는 사용자가 작업하는 내내 창이 열려 있다.
//
//  2. **no-op 생략**: 내용이 그대로인데 쓰면 mtime이 바뀌어 인덱서가 그 노트를 다시
//     임베딩한다. 스케줄러는 주기적으로 도니 매번 재임베딩하면 API 비용이 계속 발생한다.
//
// vault.process만 쓰면 (1)은 얻지만 (2)를 잃고, read → modify만 쓰면 (2)는 얻지만
// (1)을 잃는다. 먼저 값싸게 판정하고 바뀔 때만 원자적으로 쓴다.

import { TFile } from "obsidian";
import type { App } from "obsidian";

/**
 * 변환 결과가 현재 내용과 다를 때만 원자적으로 쓴다.
 *
 * 판정용 읽기는 낡은 사본일 수 있으므로, 실제 쓰기는 vault.process 안에서 **다시 읽은**
 * 최신 내용에 변환을 적용한다. 판정과 쓰기 사이에 사용자가 편집해 변환이 no-op이 되면
 * 같은 내용을 쓰게 되는데, 그건 무해하다.
 *
 * @param transform 순수 함수여야 한다. 두 번 호출되므로 부수효과가 있으면 두 번 일어난다.
 * @returns 실제로 썼으면 true
 */
export async function processIfChanged(
  app: App,
  file: TFile,
  transform: (content: string) => string
): Promise<boolean> {
  const current = await app.vault.read(file);
  if (transform(current) === current) return false;

  await app.vault.process(file, transform);
  return true;
}
