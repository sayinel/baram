// §385 The shape and size rules for a plugin prompt request (spec 0061 §7), in ONE place.
//
// Three layers ask the same questions and must not disagree: the gate's caller
// (`prompts-api.ts`, both tiers — a trusted plugin's JavaScript can pass anything the types
// forbid), the sandbox's pre-check (so an author's mistake throws instead of vanishing in
// Rust), and the host's frame validator (for a plugin that drives the transport directly).
// Tier-agnostic: no store, no DOM — the sandbox realm imports it too.
import { PROMPT_LIMITS } from "./sandbox/protocol";

/** Why an input-box request is malformed or over a limit, or `null`. */
export function inputBoxProblem(opts: unknown): null | string {
  return optsProblem(opts, true);
}

function itemProblem(raw: unknown, seen: Set<string>): null | string {
  if (typeof raw !== "object" || raw === null) return "must be an object";
  const { description, id, label } = raw as Record<string, unknown>;
  if (typeof id !== "string") return "id must be a string";
  if (id.length > PROMPT_LIMITS.idChars) {
    return `id: at most ${PROMPT_LIMITS.idChars} characters`;
  }
  if (seen.has(id)) {
    return `id "${id}" appears twice — the answer is an id, so it must name one item`;
  }
  seen.add(id);
  return (
    textProblem("label", label, false) ??
    textProblem("description", description, true)
  );
}

function optsProblem(opts: unknown, isInputBox: boolean): null | string {
  if (opts === undefined) return null;
  if (typeof opts !== "object" || opts === null)
    return "opts must be an object";
  const { placeholder, title, value } = opts as Record<string, unknown>;
  const text =
    textProblem("opts.title", title, true) ??
    textProblem("opts.placeholder", placeholder, true);
  if (text !== null || !isInputBox || value === undefined) return text;
  if (typeof value !== "string") return "opts.value must be a string";
  return value.length > PROMPT_LIMITS.valueChars
    ? `opts.value: at most ${PROMPT_LIMITS.valueChars} characters`
    : null;
}

/** Why a quick-pick request is malformed or over a limit, or `null`. */
export function quickPickProblem(items: unknown, opts: unknown): null | string {
  if (!Array.isArray(items)) return "items must be an array";
  if (items.length === 0) return "items must not be empty";
  if (items.length > PROMPT_LIMITS.items) {
    return `items: at most ${PROMPT_LIMITS.items}`;
  }
  const seen = new Set<string>();
  for (const [index, raw] of items.entries()) {
    const problem = itemProblem(raw, seen);
    if (problem !== null) return `items[${index}]: ${problem}`;
  }
  return optsProblem(opts, false);
}

function textProblem(
  name: string,
  value: unknown,
  optional: boolean,
): null | string {
  if (value === undefined && optional) return null;
  if (typeof value !== "string") return `${name} must be a string`;
  return value.length > PROMPT_LIMITS.stringChars
    ? `${name}: at most ${PROMPT_LIMITS.stringChars} characters`
    : null;
}
