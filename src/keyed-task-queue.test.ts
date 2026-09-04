import { describe, expect, it } from "vitest";
import { KeyedTaskQueue } from "./keyed-task-queue";

describe("KeyedTaskQueue", () => {
  it("서로 다른 키는 설정한 동시성까지 병렬 실행한다", async () => {
    const queue = new KeyedTaskQueue(2);
    let active = 0;
    let maxActive = 0;
    const task = () => async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await Promise.resolve();
      active--;
    };

    await Promise.all([
      queue.add("a", task()),
      queue.add("b", task()),
      queue.add("c", task()),
    ]);

    expect(maxActive).toBe(2);
  });

  it("같은 키는 등록 순서대로 하나씩 실행한다", async () => {
    const queue = new KeyedTaskQueue(2);
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const first = queue.add("same", async () => {
      order.push("first-start");
      await gate;
      order.push("first-end");
    });
    const second = queue.add("same", async () => {
      order.push("second");
    });

    await Promise.resolve();
    expect(order).toEqual(["first-start"]);
    release();
    await Promise.all([first, second]);
    expect(order).toEqual(["first-start", "first-end", "second"]);
  });

  it("onIdle은 실패한 작업까지 모두 끝난 뒤 해제된다", async () => {
    const queue = new KeyedTaskQueue(2);
    const failed = queue.add("a", async () => {
      throw new Error("실패");
    });
    const succeeded = queue.add("b", async () => {});

    await expect(failed).rejects.toThrow("실패");
    await succeeded;
    await expect(queue.onIdle()).resolves.toBeUndefined();
  });
});
