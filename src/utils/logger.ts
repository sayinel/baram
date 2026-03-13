// §3.3 Structured logger — conditional logging with module context
const isDev = import.meta.env.DEV;

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
