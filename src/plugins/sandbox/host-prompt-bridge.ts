// §385 The host side of `ctx.prompts` for sandboxed plugins (spec 0061 §9).
//
// Everything that decides about the REQUEST — gate, limits, sanitising, the window — is
// `prompts-api.ts`, shared with the trusted tier. What only this tier needs, on the way back, is
// here:
//  - a heartbeat. A prompt may stay open for minutes, and the session's 120 s stall timer and the
//    sandbox's 150 s one are KEPT — they are the only defence against a lost frame (spec 0061 §6).
//    An empty token every 60 s restarts both: the session's `onToken` rearms its timer, and the
//    `hostStreamToken` frame it sends makes the client `touch()` its own;
//  - the answer's length asserted against `PROMPT_LIMITS.valueChars` — the window never submits
//    past it, so this is a backstop, not a second policy (spec 0061 §9);
//  - the answer through `wellFormedText`: `null` for a cancel, and text with no lone surrogate,
//    which the `serde_json::Value` on the way back through Rust would refuse — the frame would
//    vanish.
import type { PromptsAPI } from "../types";
import type { PromptHostRequest } from "./protocol";

import { wellFormedText } from "../plugin-text";
import { createPromptsAPI } from "../prompts-api";
import { PROMPT_LIMITS } from "./protocol";

/** Half the host's 120 s stall timer and under the sandbox's 150 s: one lost heartbeat frame
 *  still leaves the next inside both. */
export const PROMPT_HEARTBEAT_MS = 60_000;

export interface PromptRequestHandlerOptions {
  pluginId: string;
  pluginName?: string;
  /** Injectable for tests; production builds the shared API. */
  prompts?: PromptsAPI;
}

export function createPromptRequestHandler(
  options: PromptRequestHandlerOptions,
): (
  request: PromptHostRequest,
  onToken: (token: string) => void,
) => Promise<null | string> {
  const prompts =
    options.prompts ?? createPromptsAPI(options.pluginId, options.pluginName);
  return async (request, onToken) => {
    const heartbeat = setInterval(() => onToken(""), PROMPT_HEARTBEAT_MS);
    try {
      const answer =
        request.kind === "prompt_quick_pick"
          ? await prompts.showQuickPick(request.items, request.opts)
          : await prompts.showInputBox(request.opts);
      if (answer === undefined) return null;
      // The window never submits past its limit; this is the assertion spec 0061 §9 names, so a
      // window bug cannot break D7's inline bound.
      if (
        request.kind === "prompt_input_box" &&
        answer.length > PROMPT_LIMITS.valueChars
      ) {
        throw new Error(
          `the input answer exceeds ${PROMPT_LIMITS.valueChars} characters`,
        );
      }
      return wellFormedText(answer);
    } finally {
      clearInterval(heartbeat);
    }
  };
}
