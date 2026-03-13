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
