// §3.3 Structured logger — conditional logging with module context
//
// `import.meta.env` is injected by Vite and is undefined under plain node, so reading
// `.DEV` off it threw on import. That made every module importing this logger
// unusable from a script — including `plugins/revocation.ts`, whose validator
// `scripts/validate-revocations.ts` reuses precisely so the registry CI and the app
// cannot disagree about what a revocation file means. Optional access keeps that
// reuse possible; outside Vite there is no dev build, so quiet is the right default.
// Cast rather than a bare `import.meta.env`: this module is now reachable from the
// node tsconfig too (scripts/validate-revocations.ts imports the app's validator), and
// that project has no Vite client types, so the property does not exist there.
const isDev = (import.meta as { env?: { DEV?: boolean } }).env?.DEV ?? false;

function timestamp(): string {
  return new Date().toISOString().slice(11, 23); // HH:mm:ss.SSS
}

export const logger = {
  debug: (...args: unknown[]): void => {
    if (isDev) console.log(`[DEBUG ${timestamp()}]`, ...args);
  },
  info: (...args: unknown[]): void => {
    if (isDev) console.info(`[INFO  ${timestamp()}]`, ...args);
  },
  warn: (...args: unknown[]): void => {
    if (isDev) console.warn(`[WARN  ${timestamp()}]`, ...args);
  },
  error: (...args: unknown[]): void => {
    console.error(`[ERROR ${timestamp()}]`, ...args); // always log errors
  },
} as const;
