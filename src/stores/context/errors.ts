// issue 598 — what `ensureSpaceContext` throws when the directory a space
// (journal, zettelkasten) is now pointed at is already registered as another
// context: a plain vault, the other space. The backend dedups by canonical
// path across every context, so registering the space there would have
// answered with that other context, and retiring the old registration would
// have left the space with no context of its type at all.
//
// The store names the facts and nothing more — it has no locale and no toast.
// A caller that can reach `t()` phrases them: `reportSpaceDirectoryTaken` in
// `services/space-context-migration.ts`.
import type { ContextInfo, VaultType } from "../../ipc/types";

export class SpaceDirectoryTakenError extends Error {
  constructor(
    readonly vaultType: VaultType,
    readonly dir: string,
    readonly takenBy: ContextInfo,
  ) {
    super(
      `${dir} is already registered as another context (${takenBy.label}); the ${vaultType} directory was not changed`,
    );
    this.name = "SpaceDirectoryTakenError";
  }
}
