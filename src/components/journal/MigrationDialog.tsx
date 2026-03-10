// §56a Journal Migration Dialog — bidirectional: flat ↔ hierarchy
import { useState, useEffect, useCallback } from "react";
import {
  listDir,
  readFile,
  writeFile,
  createDir,
  deleteFile,
} from "../../ipc/invoke";
import {
  detectFlatJournalFiles,
  buildMigrationPlan,
  detectHierarchicalJournalFiles,
  buildFlattenPlan,
} from "../../utils/journal";
import { useTranslation } from "../../i18n/useTranslation";

export type MigrationDirection = "toHierarchy" | "toFlat";

interface MigrationDialogProps {
  open: boolean;
  onClose: () => void;
  journalDir: string;
  direction: MigrationDirection;
}

type MigrationStatus =
  | "idle"
  | "loading"
  | "ready"
  | "migrating"
  | "done"
  | "error";

interface MigrationPair {
  from: string;
  to: string;
}

const PREVIEW_MAX = 10;

/**
 * Recursively collect all file entries under a directory.
 */
async function listDirRecursive(
  dir: string,
): Promise<{ name: string; path: string; isDir: boolean }[]> {
  const entries = await listDir(dir, false);
  const result: { name: string; path: string; isDir: boolean }[] = [];
  for (const entry of entries) {
    if (entry.isDir) {
      const children = await listDirRecursive(entry.path);
      result.push(...children);
    } else {
      result.push(entry);
    }
  }
  return result;
}

export function MigrationDialog({
  open,
  onClose,
  journalDir,
  direction,
}: MigrationDialogProps) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<MigrationStatus>("idle");
  const [plan, setPlan] = useState<MigrationPair[]>([]);
  const [migratedCount, setMigratedCount] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");

  const isToHierarchy = direction === "toHierarchy";

  // Load migration plan when dialog opens
  useEffect(() => {
    if (!open || !journalDir) return;
    setStatus("loading");
    setPlan([]);
    setMigratedCount(0);
    setErrorMsg("");

    (async () => {
      try {
        if (isToHierarchy) {
          const entries = await listDir(journalDir, false);
          const flatFiles = detectFlatJournalFiles(entries);
          const migrationPlan = buildMigrationPlan(journalDir, flatFiles);
          setPlan(migrationPlan);
        } else {
          const allEntries = await listDirRecursive(journalDir);
          const hierFiles = detectHierarchicalJournalFiles(
            journalDir,
            allEntries,
          );
          const flattenPlan = buildFlattenPlan(journalDir, hierFiles);
          setPlan(flattenPlan);
        }
        setStatus("ready");
      } catch (err) {
        setErrorMsg(String(err));
        setStatus("error");
      }
    })();
  }, [open, journalDir, isToHierarchy]);

  const handleMigrate = useCallback(async () => {
    if (plan.length === 0) return;
    setStatus("migrating");
    let count = 0;

    for (const { from, to } of plan) {
      try {
        // Ensure target directory exists
        const dir = to.substring(0, to.lastIndexOf("/"));
        await createDir(dir).catch(() => {});

        // Read source, write to destination, delete source
        const content = await readFile(from);
        await writeFile(to, content);
        await deleteFile(from);
        count++;
      } catch (err) {
        console.error(`[MigrationDialog] Failed to migrate ${from}:`, err);
      }
    }

    setMigratedCount(count);
    setStatus("done");
  }, [plan]);

  const handleClose = useCallback(() => {
    setStatus("idle");
    setPlan([]);
    onClose();
  }, [onClose]);

  if (!open) return null;

  const previewItems = plan.slice(0, PREVIEW_MAX);
  const remaining = plan.length - previewItems.length;

  const titleKey = isToHierarchy
    ? "settings.general.journalMigrate.dialogTitle"
    : "settings.general.journalFlatten.dialogTitle";
  const structureLabel = isToHierarchy ? (
    <code>daily/YYYY/MM/</code>
  ) : (
    <code>YYYY-MM-DD.md</code>
  );
  const noFilesKey = isToHierarchy
    ? "settings.general.journalMigrate.noFiles"
    : "settings.general.journalFlatten.noFiles";

  return (
    <div className="migration-dialog-overlay" onClick={handleClose}>
      <div className="migration-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="migration-dialog-header">
          <h3>{t(titleKey)}</h3>
        </div>

        <div className="migration-dialog-body">
          {status === "loading" && (
            <p className="migration-dialog-message">
              {t("settings.general.journalMigrate.scanning")}
            </p>
          )}

          {status === "error" && (
            <p className="migration-dialog-message migration-dialog-error">
              Error: {errorMsg}
            </p>
          )}

          {(status === "ready" || status === "migrating") &&
            plan.length === 0 && (
              <p className="migration-dialog-message">{t(noFilesKey)}</p>
            )}

          {(status === "ready" || status === "migrating") &&
            plan.length > 0 && (
              <>
                <p className="migration-dialog-description">
                  {t("settings.general.journalMigrate.found")
                    .replace("{count}", String(plan.length))
                    .replace("{s}", plan.length !== 1 ? "s" : "")}{" "}
                  {structureLabel}
                </p>
                <ul className="migration-dialog-list">
                  {previewItems.map(({ from, to }) => {
                    const fromRelative = from.substring(journalDir.length + 1);
                    const toRelative = to.substring(journalDir.length + 1);
                    return (
                      <li key={from} className="migration-dialog-list-item">
                        <span className="migration-dialog-from">
                          {fromRelative}
                        </span>
                        <span className="migration-dialog-arrow">→</span>
                        <span className="migration-dialog-to">
                          {toRelative}
                        </span>
                      </li>
                    );
                  })}
                  {remaining > 0 && (
                    <li className="migration-dialog-list-more">
                      ...and {remaining} more
                    </li>
                  )}
                </ul>
              </>
            )}

          {status === "done" && (
            <p className="migration-dialog-message migration-dialog-success">
              {t("settings.general.journalMigrate.done")
                .replace("{count}", String(migratedCount))
                .replace("{s}", migratedCount !== 1 ? "s" : "")}
            </p>
          )}
        </div>

        <div className="migration-dialog-actions">
          {status === "done" || (status === "ready" && plan.length === 0) ? (
            <button
              className="migration-dialog-btn migration-dialog-btn-primary"
              onClick={handleClose}
            >
              {t("common.close")}
            </button>
          ) : (
            <>
              <button
                className="migration-dialog-btn migration-dialog-btn-secondary"
                onClick={handleClose}
                disabled={status === "migrating"}
              >
                {t("common.cancel")}
              </button>
              <button
                className="migration-dialog-btn migration-dialog-btn-primary"
                onClick={handleMigrate}
                disabled={status !== "ready" || plan.length === 0}
              >
                {status === "migrating"
                  ? t("settings.general.journalMigrate.migrating")
                  : t("settings.general.journalMigrate.migrateN")
                      .replace("{count}", String(plan.length))
                      .replace("{s}", plan.length !== 1 ? "s" : "")}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
