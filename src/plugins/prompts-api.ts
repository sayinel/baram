// §385 `ctx.prompts` for both tiers (spec 0061 §4, §10): the refusal order, the limits and the
// sanitising, in front of the window. The trusted tier calls this directly; the sandboxed tier
// reaches it through `sandbox/host-prompt-bridge.ts`, so both answer to the same rules.
//
// A module under src/plugins importing a component launcher has one precedent:
// `extensions/plugins/symbol-picker-action.ts` → `components/command/show-symbol-picker.tsx`
// (plan 0109 P3). The gate itself (`prompt-gate.ts`) does not import it.
import type { PromptsAPI, QuickPickItem } from "./types";

import { showPluginPrompt } from "../components/plugins/show-plugin-prompt";
import { pluginSourceLabel, sanitizePluginText } from "./plugin-text";
import {
  PromptOccludedError,
  promptRefusal,
  revokePromptRights,
} from "./prompt-gate";
import { inputBoxProblem, quickPickProblem } from "./prompt-shape";
import { PROMPT_LIMITS } from "./sandbox/protocol";

export function createPromptsAPI(
  pluginId: string,
  pluginName: string | undefined,
): PromptsAPI {
  const source = pluginSourceLabel(pluginName, pluginId);
  return {
    showInputBox: (opts) =>
      ask(
        pluginId,
        () => inputBoxProblem(opts),
        () =>
          showPluginPrompt(pluginId, source, {
            kind: "inputBox",
            placeholder: shortText(opts?.placeholder),
            title: shortText(opts?.title),
            // Not sanitised: trimming would change the author's text (spec 0061 §7).
            value: opts?.value,
          }),
      ),
    showQuickPick: (items, opts) =>
      ask(
        pluginId,
        () => quickPickProblem(items, opts),
        () =>
          showPluginPrompt(pluginId, source, {
            items: items.map(shownItem),
            kind: "quickPick",
            placeholder: shortText(opts?.placeholder),
            title: shortText(opts?.title),
          }),
      ),
  };
}

/**
 * Ask once. The cheap gate runs before the limits, so a refused plugin does not make the host
 * walk thousands of items (spec 0061 §5.3). Everything up to `open()` is synchronous — a trusted
 * handler that asks without awaiting first gets its window in the same task.
 */
async function ask(
  pluginId: string,
  problem: () => null | string,
  open: () => Promise<string | undefined>,
): Promise<string | undefined> {
  const refusal = promptRefusal(pluginId) ?? problem();
  if (refusal !== null) throw new Error(`prompt refused: ${refusal}`);
  try {
    const answer = await open();
    if (answer === undefined) revokePromptRights(pluginId); // a cancel ends the flow (D4)
    return answer;
  } catch (err) {
    if (err instanceof PromptOccludedError) revokePromptRights(pluginId);
    throw err;
  }
}

function shortText(text: string | undefined): string | undefined {
  return text === undefined
    ? undefined
    : sanitizePluginText(text, PROMPT_LIMITS.titleChars);
}

/** The id is a comparison key and goes through untouched; only what is shown is sanitised. */
function shownItem(item: QuickPickItem): QuickPickItem {
  return {
    description:
      item.description === undefined
        ? undefined
        : sanitizePluginText(item.description, PROMPT_LIMITS.labelChars),
    id: item.id,
    label: sanitizePluginText(item.label, PROMPT_LIMITS.labelChars),
  };
}
