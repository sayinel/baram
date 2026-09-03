// §324-c 캡처가 어디로 갈지 태그를 치는 동안 미리 보여준다 — 저장을 누르기 전에 오타를
// 눈으로 잡는 것이 이 컴포넌트의 목적이다. 그래서 두 가지를 절대 하지 않는다:
//   1. 태그 칸이 비어 있는 동안 말하기 — 아직 아무것도 지목하지 않았다.
//   2. `useCaptureTargets`가 아직 `notes/`를 읽는 중일 때(`loading`) 말하기 — 그 순간에
//      "일치하는 노트 없음"을 보이면 맞는 태그를 오타로 오인하게 만든다. 미리보기와 저장이
//      같은 `CaptureTargets` 값을 쓰므로(`use-capture-targets.ts`) 이 가드는 그 계약을
//      그대로 반영한다.
import type React from "react";

import type { CaptureTargets } from "./use-capture-targets";

import { useTranslation } from "../../i18n/useTranslation";

interface CaptureTargetPreviewProps {
  /** 태그 칸이 비었는가 — 비었으면 아무 말도 하지 않는다 */
  hasTags: boolean;
  targets: CaptureTargets;
}

export function CaptureTargetPreview({
  hasTags,
  targets,
}: CaptureTargetPreviewProps): null | React.ReactElement {
  const { t } = useTranslation();

  if (!hasTags || targets.loading) return null;

  const { targets: resolved, unmatchedTags } = targets;

  // ‼️ 스캔 실패는 "일치하는 노트 없음"이 **아니다.** 후보를 못 읽었을 뿐인데 태그가
  // 틀렸다고 말하면 사용자는 멀쩡한 태그를 고치기 시작한다. 저장 경로도 같은 구분을
  // 한다(`QuickCaptureDialog`의 `scanFailed`).
  if (targets.failed) {
    return (
      <div
        aria-live="polite"
        className="quick-capture-target quick-capture-target-warn"
        role="status"
      >
        {t("journal.capture.target.scanFailed")}
      </div>
    );
  }

  // §324-a 아무것도 못 맞힌 태그는 따로 말한다 — 대상이 하나라도 있으면 그 성공에 묻혀
  // 사라지기 때문이다. 태그 모양(`#`)을 붙여 사용자가 친 그대로 되비춘다.
  const unmatched =
    unmatchedTags.length > 0 ? (
      <span className="quick-capture-target-warn">
        {" "}
        {t("journal.capture.target.unmatched", {
          tags: unmatchedTags.map((tag) => `#${tag}`).join(" "),
        })}
      </span>
    ) : null;

  // ‼️ 경고 상태는 문구만이 아니라 **클래스**로도 성공 상태와 갈린다 — §324-c가 막으려는
  // 것은 문구를 읽는 사용자가 아니라 훑어보는 사용자의 오타다.
  if (resolved.length === 0) {
    return (
      <div
        aria-live="polite"
        className="quick-capture-target quick-capture-target-warn"
        role="status"
      >
        {t("journal.capture.target.none")}
      </div>
    );
  }

  const message =
    resolved.length === 1
      ? t("journal.capture.target.one", {
          count: String(resolved[0].captureCount),
          title: resolved[0].title,
        })
      : t("journal.capture.target.many", {
          count: String(resolved.length),
          titles: resolved.map((target) => target.title).join(", "),
        });

  return (
    <div aria-live="polite" className="quick-capture-target" role="status">
      {message}
      {unmatched}
    </div>
  );
}
