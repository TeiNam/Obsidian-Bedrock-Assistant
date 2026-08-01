import { describe, it, expect } from "vitest";
import { isPluginEnabled } from "./plugin-detect";

describe("isPluginEnabled", () => {
  // 옵시디언 app 객체의 최소 형태를 흉내낸다.
  const appWith = (ids: string[]) => ({
    plugins: { enabledPlugins: new Set(ids) },
  });

  it("활성 플러그인이면 true를 반환한다", () => {
    expect(isPluginEnabled(appWith(["code-styler"]), "code-styler")).toBe(true);
  });

  it("비활성 플러그인이면 false를 반환한다", () => {
    expect(isPluginEnabled(appWith(["dataview"]), "code-styler")).toBe(false);
  });

  it("활성 플러그인이 하나도 없으면 false를 반환한다", () => {
    expect(isPluginEnabled(appWith([]), "code-styler")).toBe(false);
  });

  it("app이 null이면 false를 반환한다", () => {
    expect(isPluginEnabled(null, "code-styler")).toBe(false);
  });

  it("app이 undefined면 false를 반환한다", () => {
    expect(isPluginEnabled(undefined, "code-styler")).toBe(false);
  });

  it("plugins 속성이 없으면 false를 반환한다", () => {
    expect(isPluginEnabled({}, "code-styler")).toBe(false);
  });

  it("enabledPlugins가 없으면 false를 반환한다", () => {
    expect(isPluginEnabled({ plugins: {} }, "code-styler")).toBe(false);
  });

  it("enabledPlugins가 Set이 아니면 false를 반환한다", () => {
    expect(
      isPluginEnabled({ plugins: { enabledPlugins: ["code-styler"] } }, "code-styler")
    ).toBe(false);
  });

  it("plugins 접근 자체가 예외를 던져도 false를 반환한다", () => {
    // getter가 던지는 객체로 내부 API 접근 실패를 재현한다.
    const hostile = {
      get plugins(): unknown {
        throw new Error("접근 불가");
      },
    };

    expect(isPluginEnabled(hostile, "code-styler")).toBe(false);
  });

  it("빈 문자열 ID는 false를 반환한다", () => {
    expect(isPluginEnabled(appWith(["code-styler"]), "")).toBe(false);
  });
});
