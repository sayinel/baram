// §8.4 Performance measurement utilities

/** Measure synchronous function execution time in ms */
export function measurePerf(label: string, fn: () => void): number {
  const start = performance.now();
  fn();
  const elapsed = performance.now() - start;
  console.log(`[Baram Perf] ${label}: ${elapsed.toFixed(1)}ms`);
  return elapsed;
}

/** Measure async function execution time in ms */
export async function measurePerfAsync(
  label: string,
  fn: () => Promise<void>,
): Promise<number> {
  const start = performance.now();
  await fn();
  const elapsed = performance.now() - start;
  console.log(`[Baram Perf] ${label}: ${elapsed.toFixed(1)}ms`);
  return elapsed;
}

/** Global app start timestamp — set in main.tsx */
export let appStartTime = 0;

export function markAppStart(): void {
  appStartTime = performance.now();
}

export function logAppReady(): void {
  if (appStartTime > 0) {
    const elapsed = performance.now() - appStartTime;
    console.log(`[Baram Perf] App ready: ${elapsed.toFixed(0)}ms`);
  }
}
