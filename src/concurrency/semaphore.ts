export class Semaphore {
  private activeCount = 0;

  constructor(private readonly concurrency: number) {
    if (concurrency < 1) {
      throw new Error("Semaphore concurrency must be at least 1.");
    }
  }

  get currentCount(): number {
    return this.activeCount;
  }

  get pendingCount(): number {
    return 0;
  }

  tryAcquire(): (() => void) | undefined {
    if (this.activeCount < this.concurrency) {
      this.activeCount += 1;
      return this.createRelease();
    }

    return undefined;
  }

  private createRelease(): () => void {
    let released = false;

    return () => {
      if (released) {
        return;
      }

      released = true;
      this.activeCount -= 1;
    };
  }
}
