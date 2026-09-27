// §385 The shape and size rules for a plugin prompt request (spec 0061 §7), in ONE place.
//
// Three layers ask the same questions and must not disagree: the gate's caller
// (`prompts-api.ts`, both tiers — a trusted plugin's JavaScript can pass anything the types
// forbid), the sandbox's pre-check (so an author's mistake throws instead of vanishing in
// Rust), and the host's frame validator (for a plugin that drives the transport directly).
// Tier-agnostic: no store, no DOM — the sandbox realm imports it too.
import type { PromptHostRequest } from "./sandbox/protocol";

import { MAX_SANDBOX_REPORT_BYTES, PROMPT_LIMITS } from "./sandbox/protocol";

/** Room left for the `{type, requestId}` envelope around a request (plan 0109 P8). */
const FRAME_ENVELOPE_BYTES = 256;

/** Matches a lone surrogate only — in `u` mode a pair is one code point. NOT `g`: `test` on a
 *  global regex keeps `lastIndex` and misses the next string's hit (spec 0061 §9). */
const LONE_SURROGATE = /[\uD800-\uDFFF]/u;

/**
 * `value` (or one of its KEYS) holds a lone surrogate. Keys matter as much as values here: an
 * extra property on an item, or whatever a `toJSON` produces, is what actually crosses the wire —
 * `value` is the already-`JSON.parse`d clone of the exact text that will be sent (or was sent), so
 * walking it is walking the real shape rather than the author's in-memory object.
 */
function hasLoneSurrogate(value: unknown): boolean {
  if (typeof value === "string") return LONE_SURROGATE.test(value);
  if (Array.isArray(value)) return value.some(hasLoneSurrogate);
  if (typeof value === "object" && value !== null) {
    return Object.entries(value).some(
      ([key, v]) => LONE_SURROGATE.test(key) || hasLoneSurrogate(v),
    );
  }
  return false;
}

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

/**
 * Why the sandbox must not send `request`, or `null` — the shape rules plus two of the three
 * things Rust would drop WITHOUT answering (spec 0061 §6): a lone surrogate, which
 * `serde_json::Value` refuses to deserialise, and a report over `MAX_SANDBOX_REPORT_BYTES`
 * (`check_report_size`). Caught here, the author gets the reason at once instead of a 150 s wait.
 *
 * The THIRD silent drop — Rust's `RateClass::Transport` rate limit — is not knowable from a
 * single request's shape: it depends on how many other frames this plugin has sent recently,
 * state this module has no access to. That is exactly why the sandbox client's 150 s stall timer
 * stays in force for a prompt request too (spec 0061 §6) rather than being "covered" by this
 * check — a rate-limited request still has to time out somewhere.
 */
export function promptFrameProblem(request: PromptHostRequest): null | string {
  const shape =
    request.kind === "prompt_quick_pick"
      ? quickPickProblem(request.items, request.opts)
      : inputBoxProblem(request.opts);
  if (shape !== null) return shape;
  // Serialised ONCE: `text` is reused for both the lone-surrogate walk (via `JSON.parse`, so an
  // extra key or a `toJSON` result is inspected exactly as it will be — or was — sent) and the
  // byte count below.
  const text = JSON.stringify(request);
  if (hasLoneSurrogate(JSON.parse(text) as unknown)) {
    return "a string holds a lone surrogate (half of an emoji or another astral character — often from slicing one), which Baram's IPC cannot carry";
  }
  const limit = MAX_SANDBOX_REPORT_BYTES - FRAME_ENVELOPE_BYTES;
  const bytes = new TextEncoder().encode(text).length;
  return bytes > limit
    ? `the request is ${bytes} bytes as sent; the limit is ${limit}`
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
