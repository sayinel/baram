// Shared LLM streaming setup utility
// Eliminates boilerplate from executeAICommand and executeBlockAIWithDiff
import { listen } from "@tauri-apps/api/event";
import type { UnlistenFn } from "@tauri-apps/api/event";

import type {
  LLMDonePayload,
  LLMErrorPayload,
  LLMTokenPayload,
} from "../ipc/types";

import { reportCaughtError } from "./async-error-policy";

export interface LLMStreamCallbacks {
  onDone?(payload: LLMDonePayload): void;
  onError?(error: string): void;
  onToken(token: string): void;
}

export interface LLMStreamOptions {
  /** Aborting while the three registrations are still in flight releases
   *  every listener already registered at once and rejects with an
   *  `AbortError`; a `listen()` that settles afterwards is unlistened on
   *  arrival. Without it a caller cannot reach a half-registered stream — the
   *  cleanup is only returned once all three have settled, and an event IPC
   *  that stalls would strand the first listener for good. */
  signal?: AbortSignal;
}

/** How long a rollback waits for the unlistens it fired before rethrowing
 *  the registration failure. Each unlisten reports its own outcome anyway;
 *  the wait only keeps a prompt retry from racing them, and it must not turn
 *  into a hang when the event IPC never answers. */
const ROLLBACK_GRACE_MS = 250;

function abortError(): Error {
  return new DOMException(
    "createLLMStream: registration aborted",
    "AbortError",
  );
}

/**
 * Tauri declares `UnlistenFn` as `() => void`, but the function `listen()`
 * returns is async: it dereferences the webview's event internals and awaits
 * an IPC call, either of which can fail during teardown. Calling it bare
 * leaves that rejection unhandled — exactly the noise issue 265 is about. So
 * every unlisten goes through here: a sync throw or a rejected thenable is
 * reported, never dropped, and the result is a promise that always settles.
 */
export function unlistenQuietly(unlisten: UnlistenFn): Promise<void> {
  let result: unknown;
  try {
    result = (unlisten as () => unknown)();
  } catch (error) {
    reportCaughtError("llm-stream unlisten", error);
    return Promise.resolve();
  }
  return Promise.resolve(result)
    .then(() => undefined)
    .catch((error: unknown) => {
      reportCaughtError("llm-stream unlisten", error);
    });
}

/**
 * Sets up llm:token / llm:done / llm:error listeners for a given requestId.
 * Returns a cleanup function that unregisters all 3 listeners. Cleanup is also
 * called automatically on done/error, and is idempotent — callers run it again
 * in a `finally` without a second thought.
 *
 * issue 265: the three `listen()` calls are sequential, so a rejection from the
 * second or third used to leave the earlier listener registered for the life
 * of the window, firing on every later llm:* event. Registration now rolls
 * back on failure — waiting for those unlistens to settle — and rethrows with
 * the original error as `cause`.
 */
export async function createLLMStream(
  requestId: string,
  callbacks: LLMStreamCallbacks,
  options: LLMStreamOptions = {},
): Promise<UnlistenFn> {
  const { signal } = options;
  const unlistens: UnlistenFn[] = [];
  let done = false;

  const takeAll = (): UnlistenFn[] => {
    if (done) return [];
    done = true;
    return unlistens.splice(0);
  };

  const cleanup = () => {
    for (const un of takeAll()) void unlistenQuietly(un);
  };

  /** One registration, cut short by the signal: an abort releases what is
   *  registered so far right away, and a late arrival is released on
   *  arrival instead of joining the set. `start` is a thunk so that an
   *  already-aborted signal issues NO listen() at all — a registration whose
   *  response then stalled would have no handle anyone could ever release.
   *  Without a signal the listen() promise is awaited as is: no extra
   *  microtask hops, which callers that flush a fixed number of ticks (the
   *  mutation-task tests) depend on. */
  const register = (start: () => Promise<UnlistenFn>): Promise<UnlistenFn> => {
    if (!signal) return start();
    if (signal.aborted) return Promise.reject(abortError());
    const pending = start();
    return new Promise<UnlistenFn>((resolve, reject) => {
      // The abort only rejects; the arrival handler below releases a handle
      // that settles afterwards, so a late handle is unlistened exactly once.
      const onAbort = () => reject(abortError());
      signal.addEventListener("abort", onAbort, { once: true });
      pending.then(
        (un) => {
          signal.removeEventListener("abort", onAbort);
          if (signal.aborted) {
            void unlistenQuietly(un);
            reject(abortError());
          } else {
            resolve(un);
          }
        },
        (error: unknown) => {
          signal.removeEventListener("abort", onAbort);
          reject(error);
        },
      );
    });
  };

  // Tauri's unlisten is asynchronous, and the command's own response is
  // not ordered against the events it emitted first: when `llmComplete`
  // resolves, the last tokens and the done event for THIS request may still
  // be queued. The handlers therefore filter by requestId only — a queued
  // event for this request is part of this request and is delivered — and
  // cleanup() stops FUTURE events, it does not swallow queued ones. A caller
  // whose callbacks touch state shared between requests guards them with
  // its own ownership check (use-ghost-text.ts, use-llm-stream.ts).
  try {
    unlistens.push(
      await register(() =>
        listen<LLMTokenPayload>("llm:token", (event) => {
          if (event.payload.requestId !== requestId) return;
          callbacks.onToken(event.payload.token);
        }),
      ),
    );
    unlistens.push(
      await register(() =>
        listen<LLMDonePayload>("llm:done", (event) => {
          if (event.payload.requestId !== requestId) return;
          cleanup();
          callbacks.onDone?.(event.payload);
        }),
      ),
    );
    unlistens.push(
      await register(() =>
        listen<LLMErrorPayload>("llm:error", (event) => {
          if (event.payload.requestId !== requestId) return;
          cleanup();
          callbacks.onError?.(event.payload.error);
        }),
      ),
    );
  } catch (cause) {
    // Roll back what is registered, wait briefly for those unlistens to
    // settle, then rethrow — bounded, so a stalled event IPC cannot turn the
    // failure into a hang (each unlisten reports its own outcome regardless).
    const rollback = Promise.all(takeAll().map(unlistenQuietly));
    await Promise.race([
      rollback,
      new Promise<void>((r) => setTimeout(r, ROLLBACK_GRACE_MS)),
    ]);
    if (cause instanceof DOMException && cause.name === "AbortError") {
      throw cause;
    }
    throw new Error("createLLMStream: listener registration failed", {
      cause,
    });
  }

  return cleanup;
}
