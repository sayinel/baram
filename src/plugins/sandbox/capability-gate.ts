// §260 Phase 4b code review (M4) — the capability refusal every host bridge raises.
//
// One implementation because the MESSAGE is load-bearing, not just the check: the live
// smoke fixture and several tests match on "requires one of", and a plugin author reads
// it to learn which grant to declare. Two copies of it — `ai`/`ui`/`editor` each rolling
// their own — is how one of them ends up saying something subtly different, or drifting
// when the manifest field is renamed.
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
