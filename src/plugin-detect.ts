/**
 * 커뮤니티 플러그인 설치·활성 여부 판정 모듈.
 *
 * app.plugins.enabledPlugins는 옵시디언 공식 타입 정의에 없는 내부 API다.
 * 캐스팅과 방어 코드를 이 파일에 격리해, 호출부가 any를 다루지 않게 한다.
 */

/**
 * 지정 ID의 커뮤니티 플러그인이 활성 상태인지 판정한다.
 *
 * 내부 API에 의존하므로 접근에 실패하면 false를 반환한다. false는
 * "미설치로 간주 → 설치 버튼 표시"로 이어지는 안전한 기본값이다.
 * (true를 기본값으로 하면 미설치 사용자에게 설치 경로를 숨기게 된다.)
 */
export function isPluginEnabled(app: unknown, pluginId: string): boolean {
  if (!pluginId) return false;

  try {
    const enabled = (app as { plugins?: { enabledPlugins?: unknown } })?.plugins
      ?.enabledPlugins;
    // 옵시디언은 enabledPlugins를 항상 Set<string>으로 노출한다. 배열이나 다른
    // 형태가 오면 내부 API가 바뀐 것이므로 미설치로 간주한다.
    if (!(enabled instanceof Set)) return false;
    return enabled.has(pluginId);
  } catch {
    // 내부 API 구조가 바뀌었거나 접근이 막힌 경우.
    return false;
  }
}
