/**
 * Reject a promise that takes too long, without cancelling it.
 *
 * Moved out of `plugins/plugin-loader.ts` in §260 Phase 4c, when the AI bridge needed the
 * same bound (`ai_list_models` holds the sandbox's serial staged-read chain, and the
 * provider call underneath it has no timeout of its own). One implementation, because the
 * subtlety is easy to get wrong twice: the timer is cleared on BOTH settlements, so a
 * promise that resolves late does not leave a pending timer behind.
 *
 * ‼️ It does NOT cancel the work — the underlying request keeps running and its result is
 * discarded. Callers that care about the resource, rather than about not waiting, need
 * their own cancellation.
 */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (val) => {
        clearTimeout(timer);
        resolve(val);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}
