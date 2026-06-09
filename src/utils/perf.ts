// §8.4 Performance measurement utilities
import { logger } from "./logger";

/** Global app start timestamp — set in main.tsx */
export let appStartTime = 0;

export function logAppReady(): void {
  if (appStartTime > 0) {
    const elapsed = performance.now() - appStartTime;
    logger.debug(`[Baram Perf] App ready: ${elapsed.toFixed(0)}ms`);
  }
}

export function markAppStart(): void {
  appStartTime = performance.now();
}

/** Dev-only: time a synchronous phase and log it. Returns the callback result. */
export function timePhase<T>(label: string, fn: () => T): T {
  const start = performance.now();
  const result = fn();
  const elapsed = performance.now() - start;
  logger.debug(`[Baram Perf] ${label}: ${elapsed.toFixed(0)}ms`);
  return result;
}
