export class Deadline {
  private readonly expiresAt: number;

  constructor(timeoutMs: number) {
    this.expiresAt = Date.now() + timeoutMs;
  }

  remainingMs(): number {
    return Math.max(0, this.expiresAt - Date.now());
  }

  isExpired(): boolean {
    return this.remainingMs() === 0;
  }

  slice(preferredMs: number, minimumMs = 1): number {
    return Math.max(minimumMs, Math.min(preferredMs, this.remainingMs()));
  }
}
