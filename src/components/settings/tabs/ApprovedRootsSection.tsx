// §335 승인된 vault 루트 목록과 회수.
//
// ‼️ 회수는 기록 삭제만 한다. 현재 세션의 asset:// 부여는 남는다 — tauri scope의
// forbid는 해제할 수 없어서, 즉시 차단을 택하면 재승인이 세션 내내 죽는다.
// 그래서 "재시작 후 완전히 적용" 문구가 UI의 **계약**이다.
import { useCallback, useEffect, useState } from "react";

import type { ApprovedRoot } from "../../../ipc/approval";

import { useTranslation } from "../../../i18n/useTranslation";
import { listApprovedRoots, revokeApprovedRoot } from "../../../ipc/approval";

export function ApprovedRootsSection() {
  const { t } = useTranslation();
  const [roots, setRoots] = useState<ApprovedRoot[]>([]);

  const refresh = useCallback(async () => {
    setRoots(await listApprovedRoots());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="settings-section">
      <h3 className="settings-section-title">
        {t("settings.vault.approvedRoots.title")}
      </h3>
      <p className="settings-section-desc">
        {t("settings.vault.approvedRoots.desc")}
      </p>
      {roots.length === 0 ? (
        <p className="vault-tab-empty">
          {t("settings.vault.approvedRoots.empty")}
        </p>
      ) : (
        <ul className="approved-roots-list">
          {roots.map((r) => (
            <li className="approved-roots-item flex-header" key={r.path}>
              <span className="text-truncate" title={r.path}>
                {r.path}
              </span>
              <button
                className="btn-unstyled approved-roots-revoke"
                onClick={async () => {
                  await revokeApprovedRoot(r.path);
                  await refresh();
                }}
                type="button"
              >
                {t("settings.vault.approvedRoots.revoke")}
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="settings-section-desc">
        {t("settings.vault.approvedRoots.restartNote")}
      </p>
    </div>
  );
}
