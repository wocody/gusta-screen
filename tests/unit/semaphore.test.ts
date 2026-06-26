import { describe, expect, it } from "vitest";

import { Semaphore } from "../../src/concurrency/semaphore";

describe("Semaphore", () => {
  it("runs only one task at a time when concurrency is 1", async () => {
    const semaphore = new Semaphore(1);
    const checkpoints: string[] = [];

    const first = semaphore.runExclusive(async () => {
      checkpoints.push("first:start");
      await new Promise((resolve) => setTimeout(resolve, 50));
      checkpoints.push("first:end");
    });

    const second = semaphore.runExclusive(async () => {
      checkpoints.push("second:start");
      checkpoints.push("second:end");
    });

    await Promise.all([first, second]);

    expect(checkpoints).toEqual([
      "first:start",
      "first:end",
      "second:start",
      "second:end"
    ]);
  });
});
