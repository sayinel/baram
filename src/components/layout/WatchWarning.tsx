// §3.2 A watch this window wants but does not hold (#797) — shown until it is held, so a
// change another program makes there is not silently missed.
import { useShallow } from "zustand/shallow";

import { useTranslation } from "../../i18n/useTranslation";
import { useWatchStatusStore } from "../../services/watch-leases";

export function WatchWarning() {
  const { t } = useTranslation();
  const { capacity, other, unauthorized } = useWatchStatusStore(
    useShallow((s) => ({
      capacity: s.queued.capacity,
      other: s.queued.other,
      unauthorized: s.queued.unauthorized,
    })),
  );
  const count = capacity + other + unauthorized;
  if (count === 0) return null;
  const reason =
    capacity > 0
      ? t("watch.unheld.capacity")
      : unauthorized > 0
        ? t("watch.unheld.unauthorized")
        : t("watch.unheld.other");
  return (
    <div className="watch-warning" role="alert">
      {t("watch.unheld", { count: String(count) })} {reason}
    </div>
  );
}
