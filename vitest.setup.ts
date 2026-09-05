// 테스트 전역 준비.
//
// 플러그인 코드는 타이머를 `window.setTimeout`/`window.clearTimeout`으로 호출한다
// (옵시디언 커뮤니티 가이드라인이 요구하는 형태다). 테스트는 node 환경에서 돌아
// `window`가 없으므로, 같은 전역을 `window`라는 이름으로도 보이게 한다.
if (typeof (globalThis as { window?: unknown }).window === "undefined") {
  (globalThis as { window?: unknown }).window = globalThis;
}
