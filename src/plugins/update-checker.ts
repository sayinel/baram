// §69 Plugin Update Checker — Periodic background check
import { checkForUpdates } from "./registry-client";

let intervalId: null | ReturnType<typeof setInterval> = null;
const CHECK_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours

/** Start periodic update checking */
export function startUpdateChecker(): void {
  if (intervalId) return;

  // Initial check (delayed to not block startup)
  setTimeout(() => {
    checkForUpdates().catch((err) =>
      console.warn("[UpdateChecker] Initial check failed:", err),
    );
  }, 10_000); // 10 seconds after startup

  // Periodic check
  intervalId = setInterval(() => {
    checkForUpdates().catch((err) =>
      console.warn("[UpdateChecker] Periodic check failed:", err),
    );
  }, CHECK_INTERVAL);
}

/** Stop periodic update checking */
export function stopUpdateChecker(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}
