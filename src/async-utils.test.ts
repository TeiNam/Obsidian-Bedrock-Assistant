import { describe, it, expect, vi, afterEach } from "vitest";
import { voidAsync } from "./async-utils";

describe("voidAsync", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("인자를 그대로 넘기고 undefined를 반환한다", () => {
    const calls: number[] = [];
    const wrapped = voidAsync(async (n: number) => {
      calls.push(n);
    });
    expect(wrapped(7)).toBeUndefined();
    expect(calls).toEqual([7]);
  });

  it("거부를 밖으로 흘리지 않고 콘솔에 남긴다", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const wrapped = voidAsync(() => Promise.reject(new Error("boom")));

    // 호출 자체가 던지지 않아야 한다(이벤트 리스너 안에서 터지면 잡을 곳이 없다).
    expect(() => wrapped()).not.toThrow();
    // 마이크로태스크 큐를 비워 catch 가 실행되게 한다.
    await Promise.resolve();

    expect(spy).toHaveBeenCalledOnce();
    expect(String(spy.mock.calls[0][0])).toContain("boom");
  });
});
