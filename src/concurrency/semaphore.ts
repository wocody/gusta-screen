export class Semaphore {
  private activeCount = 0;
  private readonly queue: Array<() => void> = [];

  constructor(private readonly concurrency: number) {
    if (concurrency < 1) {
      throw new Error("Semaphore concurrency must be at least 1.");
    }
  }

  get currentCount(): number {
    return this.activeCount;
  }

  get pendingCount(): number {
    return this.queue.length;
  }

  async acquire(): Promise<() => void> {
    if (this.activeCount < this.concurrency) {
      this.activeCount += 1;
      return this.createRelease();
    }

    return await new Promise<() => void>((resolve) => {
      this.queue.push(() => {
        this.activeCount += 1;
        resolve(this.createRelease());
      });
    });
  }

  async runExclusive<T>(task: () => Promise<T>): Promise<T> {
    const release = await this.acquire();

    try {
      return await task();
    } finally {
      release();
    }
  }

  private createRelease(): () => void {
    let released = false;

    return () => {
      if (released) {
        return;
      }

      released = true;
      this.activeCount -= 1;
      const next = this.queue.shift();
      next?.();
    };
  }
}
