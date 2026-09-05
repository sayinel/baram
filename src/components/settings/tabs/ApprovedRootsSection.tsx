// §335 승인된 vault 루트 목록과 회수.
//
// ‼️ 회수는 **승인 기록 삭제 + 컨텍스트 제거**, 둘 다다 (§335). 기록만 지우면
// `validate_path_any`는 그대로 통과하므로 그 루트의 **읽기도 쓰기도** 세션 내내
// 계속된다 — 즉 §335가 "잔여 노출은 asset:// 읽기 한정"이라고 말할 근거가 사라진다.
// 컨텍스트를 지워야 FS 가드가 즉시 닫히고, 그 문장이 참이 된다.
//
// ‼️ 남는 것은 이번 세션의 asset:// 부여뿐이다 — tauri scope의 forbid는 해제할 수
// 없어서, 즉시 차단을 택하면 재승인이 세션 내내 죽는다. 그래서 "재시작 후 완전히
// 적용" 문구가 UI의 **계약**이다.
import { useCallback, useEffect, useState } from "react";

import type { ApprovedRoot } from "../../../ipc/approval";
import type { ContextInfo } from "../../../ipc/types";

import { useTranslation } from "../../../i18n/useTranslation";
import {
  isPathApproved,
  listApprovedRoots,
  revokeApprovedRoot,
} from "../../../ipc/approval";
import { closeContexts } from "../../../services/close-context";
import { useContextStore } from "../../../stores/context/context";
import { useUIStore } from "../../../stores/ui/ui";
import { logger } from "../../../utils/logger";

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
        // 회수 전 스냅샷 — "이 회수가 무엇을 잃게 했는가"를 재려면 전후가 다 필요하다.
        const before = useContextStore.getState().contexts;
        const wasApproved = await Promise.all(
          before.map((c) => isPathApproved(c.path).catch(() => false)),
        );
        try {
          await revokeApprovedRoot(path);
        } catch (err) {
          // §335 리뷰 Minor 1 — IPC 실패를 삼키면 항목은 그대로인데 클릭이 아무
          // 반응 없어 보인다. 에러 토스트가 사용자의 유일한 피드백이다.
          showToast(
            t("settings.vault.approvedRoots.revokeFailed", {
              error: String(err),
            }),
            "error",
          );
          return;
        }
        // §90(M5) 회수는 이미 끝났다 — 여기서부터 실패해도 "회수 실패"는 거짓말이다
        // (예: 남은 컨텍스트로 전환하며 트리를 다시 읽다가 실패하는 경우). 그
        // 실패를 위 catch로 흘려보내면 성공한 회수가 "Failed to revoke"로
        // 보고된다. 후속 정리 실패는 로그로만 남긴다 — `_loadContextFileTree`가
        // 이미 자기 몫의 진짜 메시지(권한 거부·읽기 실패)를 띄운다.
        try {
          await removeContexts(
            await contextsThisRevokeUnapproved(before, wasApproved),
          );
          await refresh();
        } catch (err) {
          logger.warn("§90(M5) revoke: post-revoke cleanup failed", path, err);
        }
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

/**
 * 이 회수 **때문에** 승인을 잃은 컨텍스트들. 회수 전후로 Rust에 물어 뒤집힌 것만
 * 고른다.
 *
 * ‼️ 프런트에서 경로 prefix를 비교하지 않는 이유가 둘이다. (1) `covers`는 컴포넌트
 * 단위 prefix + canonicalize라 심링크를 지난 컨텍스트 경로를 문자열 비교로는 못
 * 맞춘다. (2) 회수된 항목이 부모 Dir이면 그 아래 File 항목도 함께 죽는데, 그 관계를
 * 아는 것도 Rust다. 전/후 비교라 "원래부터 승인이 없던 것"(삭제된 폴더 등)을 이
 * 회수의 부수 피해로 지우지도 않는다 — 사용자 상태를 지우는 코드이므로 정확해야 한다.
 */
async function contextsThisRevokeUnapproved(
  before: ContextInfo[],
  wasApproved: boolean[],
): Promise<ContextInfo[]> {
  const doomed: ContextInfo[] = [];
  for (const [i, ctx] of before.entries()) {
    if (!wasApproved[i]) continue;
    // IPC 실패는 "여전히 승인됨"으로 읽는다 — 확신 없이 지우지 않는다.
    const stillApproved = await isPathApproved(ctx.path).catch(() => true);
    if (!stillApproved) doomed.push(ctx);
  }
  return doomed;
}

/**
 * §335 회수의 나머지 절반 — 컨텍스트 제거. 활성 컨텍스트를 회수했다면 남은 것 중
 * 하나로 전환하고, 하나도 안 남으면 홈 화면으로 돌아간다(회수한 vault의 트리를 그대로
 * 띄워 두면 "회수됐다"와 화면이 어긋난다).
 *
 * ‼️ §82 공용 `closeContexts`를 쓴다. 예전에는 여기서 손으로 컨텍스트만 지우고
 * `setRootPath(null)`+`setFileTree([])`로 끝냈는데, 그러면 (1) 회수된 vault의 **탭이
 * 그대로 열려 있고** — 쓸 수 없는 경로를 편집 가능한 것처럼 보여준다 — (2)
 * `lastOpenedFolder`가 남아 **다음 실행에서 회수한 폴더를 다시 열려 한다.**
 *
 * ‼️ 묻지 않는 것은 의도다. `requestCloseContexts`(확인 창)가 아니라 `closeContexts`를
 * 부른다 — 회수는 보안 조치라 "취소"가 있어서는 안 되고, 접근이 사라진 뒤에는 저장할
 * 방법도 없다.
 */
async function removeContexts(doomed: ContextInfo[]): Promise<void> {
  if (doomed.length === 0) return;
  await closeContexts(doomed.map((c) => c.id));
}
