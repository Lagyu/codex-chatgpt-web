import { expect, test } from "bun:test";
import { LauncherSmokeTestBusyError, waitForLauncherSmokeTest } from "../src/launcher-smoke-wait";

test("an explicitly busy smoke test delays admission until it releases the browser", async () => {
  let checks = 0;
  let admissions = 0;
  const result = await waitForLauncherSmokeTest(async () => {
    if (++checks === 1) throw new LauncherSmokeTestBusyError("busy");
    admissions++;
    return "admitted";
  });
  expect(result).toBe("admitted");
  expect(checks).toBe(2);
  expect(admissions).toBe(1);
});

test("ordinary errors and ambiguous transport failures never enter the smoke wait", async () => {
  for (const error of [new Error("browser busy with login"), new TypeError("fetch failed")]) {
    let calls = 0;
    await expect(waitForLauncherSmokeTest(async () => { calls++; throw error; })).rejects.toBe(error);
    expect(calls).toBe(1);
  }
});

test("cancelling while smoke is busy prevents any later admission", async () => {
  const controller = new AbortController();
  let calls = 0;
  await expect(waitForLauncherSmokeTest(async () => {
    calls++;
    queueMicrotask(() => controller.abort());
    throw new LauncherSmokeTestBusyError("busy");
  }, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  expect(calls).toBe(1);
  await expect(waitForLauncherSmokeTest(async () => { calls++; }, controller.signal))
    .rejects.toMatchObject({ name: "AbortError" });
  expect(calls).toBe(1);
});

test("a smoke lock that never releases has a bounded wait", async () => {
  let calls = 0;
  await expect(waitForLauncherSmokeTest(async () => {
    calls++;
    throw new LauncherSmokeTestBusyError("busy");
  }, undefined, 1)).rejects.toThrow("did not release the browser");
  expect(calls).toBeGreaterThanOrEqual(2);
});
