// §335 승인된 vault 루트 목록과 회수.
//
// ‼️ 회수는 기록 삭제만 한다. 현재 세션의 asset:// 부여는 남는다 — tauri scope의
// forbid는 해제할 수 없어서, 즉시 차단을 택하면 재승인이 세션 내내 죽는다.
// 그래서 "재시작 후 완전히 적용" 문구가 UI의 **계약**이다.
import { useCallback, useEffect, useState } from "react";

import type { ApprovedRoot } from "../../../ipc/approval";

import { useTranslation } from "../../../i18n/useTranslation";
import { listApprovedRoots, revokeApprovedRoot } from "../../../ipc/approval";
import { useUIStore } from "../../../stores/ui/ui";

export function ApprovedRootsSection() {
  const { t } = useTranslation();
  const showToast = useUIStore((s) => s.showToast);
  const [roots, setRoots] = useState<ApprovedRoot[]>([]);
  // §335 리뷰 Minor 3 — 회수 중인 경로만 담아, 그 항목의 버튼만 disable한다.
  // 이게 없으면 더블클릭이 revoke/refresh를 두 번 겹쳐 쏴서 순서가 뒤엉킨다.
  const [revoking, setRevoking] = useState<Set<string>>(new Set());

  const refresh = useCallback(async () => {
    try {
      setRoots(await listApprovedRoots());
    } catch (err) {
      // §335 리뷰 Minor 2 — 실패를 삼키면 "승인 0건"과 "불러오기 실패"가 화면에서
      // 구별 안 된다. 사용자는 vault가 계속 열리는 이유를 못 찾는다.
      showToast(
        t("settings.vault.approvedRoots.loadFailed", { error: String(err) }),
        "error",
      );
    }
  }, [showToast, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleRevoke = useCallback(
    async (path: string) => {
      setRevoking((prev) => new Set(prev).add(path));
      try {
        await revokeApprovedRoot(path);
        await refresh();
      } catch (err) {
        // §335 리뷰 Minor 1 — IPC 실패를 삼키면 항목은 그대로인데 클릭이 아무
        // 반응 없어 보인다. 에러 토스트가 사용자의 유일한 피드백이다.
        showToast(
          t("settings.vault.approvedRoots.revokeFailed", {
            error: String(err),
          }),
          "error",
        );
      } finally {
        setRevoking((prev) => {
          const next = new Set(prev);
          next.delete(path);
          return next;
        });
      }
    },
    [refresh, showToast, t],
  );

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
                disabled={revoking.has(r.path)}
                onClick={() => {
                  void handleRevoke(r.path);
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
