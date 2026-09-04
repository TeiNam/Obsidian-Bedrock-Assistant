interface PendingTask {
  key: string;
  run: () => Promise<void>;
  resolve: () => void;
  reject: (error: unknown) => void;
}

/**
 * 서로 다른 키는 제한된 수만큼 병렬 실행하고, 같은 키는 입력 순서를 보존한다.
 */
export class KeyedTaskQueue {
  private pending: PendingTask[] = [];
  private active = 0;
  private activeKeys = new Set<string>();
  private idleWaiters: Array<() => void> = [];

  constructor(private readonly concurrency: number) {
    if (!Number.isInteger(concurrency) || concurrency < 1) {
      throw new Error("concurrency는 1 이상의 정수여야 합니다.");
    }
  }

  add(key: string, run: () => Promise<void>): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.pending.push({ key, run, resolve, reject });
      this.drain();
    });
  }

  onIdle(): Promise<void> {
    if (this.active === 0 && this.pending.length === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  private drain(): void {
    while (this.active < this.concurrency) {
      const index = this.pending.findIndex((task) => !this.activeKeys.has(task.key));
      if (index === -1) return;

      const [task] = this.pending.splice(index, 1);
      this.active++;
      this.activeKeys.add(task.key);

      void Promise.resolve()
        .then(task.run)
        .then(task.resolve, task.reject)
        .finally(() => {
          this.active--;
          this.activeKeys.delete(task.key);
          this.drain();
          if (this.active === 0 && this.pending.length === 0) {
            const waiters = this.idleWaiters.splice(0);
            for (const resolve of waiters) resolve();
          }
        });
    }
  }
}
