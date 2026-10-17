// §394 spec 0073 D11 ③ — the second entrance of §385 prompt rights. A `data-action` click inside a
// plugin-rendered block is the user pressing that plugin's control, the same weight as running
// one of its commands (spec 0061 §13 foresaw this entrance). Rights begin here, before the
// handler runs, and end in `finally`. Its one caller is the rendered block's click path, after
// `isTrusted` (`rendered/rendered-clicks.ts`); `execute-plugin-command-callers.test.ts` pins this
// file as the second site that calls `beginPluginInvocation`. A rendered document grants nothing
// by being drawn.

import { logger } from "../utils/logger";
import { withTimeout } from "../utils/with-timeout";
import { beginPluginInvocation } from "./prompt-gate";

/**
 * Run `run` — the plugin's action handler — as a user-started invocation of `pluginId`. Resolves
 * when the handler settles or after `timeoutMs`, whichever is first; `null` means no timeout here,
 * because the caller's own call has one (a sandboxed `invokeAction` ends at the session's
 * `CALL_TIMEOUT_MS`, paused while a prompt is open — the rule a command follows). Never rejects:
 * a failure, a refusal or a timeout is logged, with no toast (spec 0073 §6).
 */
export async function runPluginAction(
  pluginId: string,
  run: () => Promise<void> | void,
  timeoutMs: null | number,
): Promise<void> {
  const end = beginPluginInvocation(pluginId);
  try {
    const handled = Promise.resolve().then(run);
    await (timeoutMs === null
      ? handled
      : withTimeout(
          handled,
          timeoutMs,
          `the action handler did not settle in ${timeoutMs} ms`,
        ));
  } catch (err) {
    logger.warn(`[PluginAction] ${pluginId}:`, err);
  } finally {
    end();
  }
}
