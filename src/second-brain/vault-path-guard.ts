/**
 * vault-path-guard.ts
 *
 * 볼트 경로 안전성 검증 순수 모듈 (Second Brain Layer 공용).
 *
 * Obsidian의 `normalizePath`는 슬래시 병합·앞뒤 슬래시 제거·NFC 정규화만 수행하며
 * `..` 세그먼트를 **해석하지 않는다**. 따라서 아래와 같은 문자열 prefix 검사만으로는
 * 경로 탈출을 막을 수 없다.
 *
 *   normalizePath("Second Brain/../../etc/x")  // → "Second Brain/../../etc/x"
 *   → startsWith("Second Brain/") 가 true 가 되어 가드를 통과한다
 *
 * 이 모듈은 세그먼트 단위로 `..`·절대경로·드라이브 문자를 직접 거부해 실제 탈출을
 * 차단한다. 순수 함수이므로 단위 테스트가 가능하다.
 */

/** 경로 검증 결과. */
export type PathGuardResult =
  | { ok: true; path: string }
  | { ok: false; reason: string };

/**
 * 경로에 볼트를 벗어나려는 요소가 있는지 판별한다.
 * - 절대 경로(`/`로 시작)
 * - 윈도우 드라이브 접두사(`C:`)
 * - 상위 디렉터리 세그먼트(`..`)
 */
export function escapesVault(rawPath: string): boolean {
  const raw = String(rawPath ?? "");
  if (raw.startsWith("/") || /^[A-Za-z]:/.test(raw)) return true;
  // 구분자(슬래시/백슬래시)로 분할해 `..` 세그먼트를 직접 찾는다.
  return raw.split(/[\\/]+/).some((segment) => segment === "..");
}

/**
 * 대상 경로가 지정된 폴더 범위 안에 있는지 검증한다.
 *
 * 문자열 prefix 검사에 앞서 `..`·절대경로를 거부하므로, prefix를 만족하면서도
 * 실제로는 폴더 밖을 가리키는 경로를 막는다.
 *
 * @param targetPath 검증할 경로(정규화 전/후 모두 허용)
 * @param folder     허용 범위 폴더 경로
 */
export function ensureWithinFolder(targetPath: string, folder: string): PathGuardResult {
  const target = String(targetPath ?? "");
  const root = String(folder ?? "");

  if (escapesVault(target)) {
    return {
      ok: false,
      reason: `경로에 상위 디렉터리 탈출(..) 또는 절대 경로가 포함되어 거부되었습니다: ${target}`,
    };
  }

  // 폴더 자신 또는 그 하위만 허용한다.
  if (target !== root && !target.startsWith(`${root}/`)) {
    return {
      ok: false,
      reason: `${root} 폴더 밖으로의 쓰기는 허용되지 않습니다: ${target}`,
    };
  }

  return { ok: true, path: target };
}
