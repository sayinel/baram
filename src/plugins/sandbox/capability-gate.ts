// §260 Phase 4b code review (M4) — the capability refusal every host bridge raises.
//
// One implementation because the MESSAGE is load-bearing, not just the check: the live
// smoke fixture and several tests match on "requires one of", and a plugin author reads
// it to learn which grant to declare. Two copies of it is how one ends up saying something
// subtly different, or drifting when the manifest field is renamed.
//
// TWO gates, because the sentence differs: a service whose grant is a CHOICE
// (`editor` / `editor:readonly`, and the three that admit `ui`) says "requires one of",
// while one that needs a SINGLE capability (`ai`, `settings`) says `requires the "ai"
// capability` — "requires one of \"ai\"" is a worse error. Both live here so the wording
// and the manifest-field name it names have one home (§260 Phase 4c: `settings` became the
// second single-capability service, and a second copy of that sentence is how they drift).
import type { PluginCapability } from "../types";

/**
 * Refuse unless the plugin holds one of `accepted`.
 *
 * `service` and `method` name the call as the plugin wrote it (`editor.getMarkdown`), so
 * the error points at the line to change rather than at an internal request kind.
 */
export function createCapabilityGate(
  pluginId: string,
  capabilities: readonly PluginCapability[],
  service: string,
): (accepted: readonly PluginCapability[], method: string) => void {
  const granted = new Set(capabilities);
  return (accepted, method) => {
    if (accepted.some((c) => granted.has(c))) return;
    throw new Error(
      `Plugin ${pluginId} requires one of ${accepted.map((c) => `"${c}"`).join(", ")} ` +
        `to call ${service}.${method}. Add it to the capabilities array in baram-plugin.json.`,
    );
  };
}

/**
 * Refuse unless the plugin holds `required` — for a service that needs exactly one grant.
 *
 * No method name in the message, because the whole service is either available or not: an
 * `ai`-less plugin cannot call `complete` OR `stream`, so naming one of them would suggest
 * the other might work.
 */
export function createRequiredCapabilityGate(
  pluginId: string,
  capabilities: readonly PluginCapability[],
  required: PluginCapability,
): () => void {
  const granted = capabilities.includes(required);
  return () => {
    if (granted) return;
    throw new Error(
      `Plugin ${pluginId} requires the "${required}" capability. ` +
        `Add "${required}" to the capabilities array in baram-plugin.json.`,
    );
  };
}
