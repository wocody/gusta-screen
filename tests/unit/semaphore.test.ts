import { describe, expect, it } from "vitest";

import { Semaphore } from "../../src/concurrency/semaphore";

describe("Semaphore", () => {
  it("acquires immediately while under capacity", () => {
    const semaphore = new Semaphore(2);

    const firstRelease = semaphore.tryAcquire();
    const secondRelease = semaphore.tryAcquire();

    expect(firstRelease).toBeTypeOf("function");
    expect(secondRelease).toBeTypeOf("function");
    expect(semaphore.currentCount).toBe(2);

    firstRelease?.();
    secondRelease?.();
    expect(semaphore.currentCount).toBe(0);
  });

  it("rejects immediately when capacity is exhausted", () => {
    const semaphore = new Semaphore(1);

    const release = semaphore.tryAcquire();
    const blocked = semaphore.tryAcquire();

    expect(release).toBeTypeOf("function");
    expect(blocked).toBeUndefined();
    expect(semaphore.currentCount).toBe(1);

    release?.();
    expect(semaphore.currentCount).toBe(0);
  });
});
