import type { VaultType } from "../ipc/types";
import type { SpaceDefinition } from "./types";

const spaces = new Map<VaultType, SpaceDefinition>();

/** Test-only: clear the registry between tests. */
export function __resetSpacesForTest(): void {
  spaces.clear();
}

export function getSpace(
  type: null | undefined | VaultType,
): SpaceDefinition | undefined {
  if (!type) return undefined;
  return spaces.get(type);
}

export function listSpaces(): SpaceDefinition[] {
  return [...spaces.values()];
}

export function registerSpace(def: SpaceDefinition): void {
  spaces.set(def.type, def);
}
