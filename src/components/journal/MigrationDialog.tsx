// §56a Journal Migration Dialog — move flat YYYY-MM-DD.md files to daily/YYYY/MM/ structure
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
} from "../../utils/journal";

interface MigrationDialogProps {
  open: boolean;
  onClose: () => void;
  journalDir: string;
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

export function MigrationDialog({
  open,
  onClose,
  journalDir,
}: MigrationDialogProps) {
  const [status, setStatus] = useState<MigrationStatus>("idle");
  const [plan, setPlan] = useState<MigrationPair[]>([]);
  const [migratedCount, setMigratedCount] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");

  // Load migration plan when dialog opens
  useEffect(() => {
    if (!open || !journalDir) return;
    setStatus("loading");
    setPlan([]);
    setMigratedCount(0);
    setErrorMsg("");

    (async () => {
      try {
        const entries = await listDir(journalDir, false);
        const flatFiles = detectFlatJournalFiles(entries);
        const migrationPlan = buildMigrationPlan(journalDir, flatFiles);
        setPlan(migrationPlan);
        setStatus("ready");
      } catch (err) {
        setErrorMsg(String(err));
        setStatus("error");
      }
    })();
  }, [open, journalDir]);

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

  return (
    <div className="migration-dialog-overlay" onClick={handleClose}>
      <div className="migration-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="migration-dialog-header">
          <h3>Migrate Journal Files</h3>
        </div>

        <div className="migration-dialog-body">
          {status === "loading" && (
            <p className="migration-dialog-message">
              Scanning journal directory...
            </p>
          )}

          {status === "error" && (
            <p className="migration-dialog-message migration-dialog-error">
              Error: {errorMsg}
            </p>
          )}

          {(status === "ready" || status === "migrating") &&
            plan.length === 0 && (
              <p className="migration-dialog-message">
                No flat journal files found to migrate.
              </p>
            )}

          {(status === "ready" || status === "migrating") &&
            plan.length > 0 && (
              <>
                <p className="migration-dialog-description">
                  Found {plan.length} journal file{plan.length !== 1 ? "s" : ""}{" "}
                  that can be organized into <code>daily/YYYY/MM/</code>{" "}
                  structure.
                </p>
                <ul className="migration-dialog-list">
                  {previewItems.map(({ from, to }) => {
                    const fromName = from.substring(from.lastIndexOf("/") + 1);
                    const toRelative = to.substring(journalDir.length + 1);
                    return (
                      <li key={from} className="migration-dialog-list-item">
                        <span className="migration-dialog-from">
                          {fromName}
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
              {migratedCount} file{migratedCount !== 1 ? "s" : ""} migrated
              successfully.
            </p>
          )}
        </div>

        <div className="migration-dialog-actions">
          {status === "done" || (status === "ready" && plan.length === 0) ? (
            <button
              className="migration-dialog-btn migration-dialog-btn-primary"
              onClick={handleClose}
            >
              Close
            </button>
          ) : (
            <>
              <button
                className="migration-dialog-btn migration-dialog-btn-secondary"
                onClick={handleClose}
                disabled={status === "migrating"}
              >
                Cancel
              </button>
              <button
                className="migration-dialog-btn migration-dialog-btn-primary"
                onClick={handleMigrate}
                disabled={status !== "ready" || plan.length === 0}
              >
                {status === "migrating"
                  ? "Migrating..."
                  : `Migrate ${plan.length} file${plan.length !== 1 ? "s" : ""}`}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
