// The launcher rejects these requests before inspecting a page or allocating a turn.
// Waiting for this explicit response never resends a ChatGPT message (ADR-0006).
export class LauncherSmokeTestBusyError extends Error {}

export const LAUNCHER_SMOKE_WAIT_TIMEOUT_MS = 120_000;

export async function waitForLauncherSmokeTest<T>(
  action: () => Promise<T>,
  signal?: AbortSignal,
  timeoutMs = LAUNCHER_SMOKE_WAIT_TIMEOUT_MS,
): Promise<T> {
  let deadline: number | undefined;
  while (true) {
    signal?.throwIfAborted();
    try {
      return await action();
    } catch (error) {
      if (!(error instanceof LauncherSmokeTestBusyError)) throw error;
      deadline ??= Date.now() + timeoutMs;
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error("The browser smoke test did not release the browser within two minutes", { cause: error });
      await new Promise<void>((resolve, reject) => {
        const abort = () => {
          clearTimeout(timer);
          signal?.removeEventListener("abort", abort);
          reject(signal?.reason ?? new DOMException("Browser wait aborted", "AbortError"));
        };
        const timer = setTimeout(() => {
          signal?.removeEventListener("abort", abort);
          resolve();
        }, Math.min(1_000, remaining));
        signal?.addEventListener("abort", abort, { once: true });
        if (signal?.aborted) abort();
      });
    }
  }
}
