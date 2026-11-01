// §395 — test helper: what the app told plugins (`onFileNotice`) and the vault (`subscribeVaultChanges`),
// in one ordered list, so a test can read "the notice came before the vault's change".
import { subscribeVaultChanges } from "../../../services/vault-changes";
import { onFileNotice } from "../operation-notices";

export function recordNotices(): { events: string[]; stop: () => void } {
  const events: string[] = [];
  const offNotices = onFileNotice((notice) => {
    events.push(
      notice.kind === "rename"
        ? `rename ${notice.from} → ${notice.to}${notice.isDir ? " dir" : ""}`
        : `delete ${notice.path}${notice.isDir ? " dir" : ""}`,
    );
  });
  const offVault = subscribeVaultChanges((id) => events.push(`vault ${id}`));
  return {
    events,
    stop: () => {
      offNotices();
      offVault();
    },
  };
}
