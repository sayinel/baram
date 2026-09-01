// M2-b4 태스크 편집 모달 — 입력 규칙을 외우지 않아도 되는 하나의 길.
//
// 이 화면의 절반은 **가르치는 일**이다. 아래 미리보기가 폼을 고칠 때마다 결과 줄을
// 그대로 보여 주므로, 사용자는 `📅2026-08-30`이 어디서 오는지 보면서 배운다. 그래서
// 미리보기는 장식이 아니라 이 모달이 존재하는 이유의 절반이다(§18.15).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { TaskEditTarget } from "../../utils/tasks/task-edit-target";
import type { DateKind, TaskLineDraft } from "../../utils/tasks/task-line-edit";
import type { Editor } from "@tiptap/react";

import { X } from "lucide-react";
import { useShallow } from "zustand/shallow";

import { useEditorContext } from "../../contexts/editor-context";
import { useTranslation } from "../../i18n/useTranslation";
import { TASK_STATE_MARKER } from "../../ipc/types";
import { useEditorStore } from "../../stores/editor/editor";
import { useUIStore } from "../../stores/ui/ui";
import { resolveDateInput } from "../../utils/tasks/task-date-input";
import {
  applyTargetLine,
  readTargetLine,
} from "../../utils/tasks/task-edit-io";
import { resolveTaskEditTarget } from "../../utils/tasks/task-edit-target";
import { readTaskLine, writeTaskLine } from "../../utils/tasks/task-line-edit";

/** 폼에 놓는 날짜 네 칸. 완료·취소일은 상태 전이가 찍는 값이라 폼이 다루지 않는다. */
const DATE_KINDS: DateKind[] = ["created", "start", "scheduled", "due"];

/** 가중치 → i18n 키. `PRIORITY_MARKER_BY_WEIGHT`와 같은 축이다. */
const PRIORITY_OPTIONS: { key: string; weight: number }[] = [
  { key: "tasks.edit.priority.urgent", weight: 2 },
  { key: "tasks.edit.priority.high", weight: 1 },
  { key: "tasks.edit.priority.normal", weight: 0 },
  { key: "tasks.edit.priority.low", weight: -1 },
  { key: "tasks.edit.priority.lowest", weight: -2 },
];

export function TaskEditDialog() {
  const { t } = useTranslation();
  const editor = useEditorContext();
  const { closeTaskEdit, taskEditOpen } = useUIStore(
    useShallow((s) => ({
      closeTaskEdit: s.closeTaskEdit,
      taskEditOpen: s.taskEditOpen,
    })),
  );

  const [target, setTarget] = useState<null | TaskEditTarget>(null);
  const [draft, setDraft] = useState<null | TaskLineDraft>(null);
  // 이슈 498: 저장이 거부됐음을 알리는 플래그와 그 이유. 문서가 모달 밖에서 바뀌면
  // (stale) 캡처된 target이 무효가 되고, 소스 모드가 켜져 있으면(sourceMode) PM에만
  // 닿는 이 저장이 소스 버퍼와 갈라져 복귀·Cmd+S에서 소실된다. 어느 쪽이든 조용히
  // 닫으면 입력한 내용이 통째로 증발한다 — 닫지 않고 이유를 띄워 복사할 기회를 준다.
  const [blocked, setBlocked] = useState<"sourceMode" | "stale" | null>(null);
  // 이슈 498 (감사 MAJOR): 이 모달이 소유한 에디터. Ctrl+Tab 등으로 활성 에디터
  // 인스턴스가 바뀌어도(keepalive 스왑) 열려 있는 draft를 새 에디터의 커서 블록으로
  // 갈아치우지 않고, 저장이 다른 문서에 닿지 않게 한다.
  const ownerRef = useRef<Editor | null>(null);
  // 날짜는 입력 중인 글자를 그대로 들고 있는다 — `t`/`+3`을 치는 동안 ISO로 바꿔 버리면
  // 두 글자를 칠 수 없다. 확정은 blur와 저장 시점에 한다.
  const [dateText, setDateText] = useState<Record<string, string>>({});
  const [tagText, setTagText] = useState("");

  useEffect(() => {
    if (!taskEditOpen) {
      // 닫힐 때 거부 상태를 지운다 — 재오픈 첫 render가 지난번의 blocked로 커밋되면
      // role="alert"가 잘못된 경고를 한 프레임 다시 발표한다.
      ownerRef.current = null;
      setBlocked(null);
      return;
    }
    if (ownerRef.current && ownerRef.current !== editor) {
      // 열려 있는 동안 활성 에디터 인스턴스가 바뀌었다. 여기서 draft를 다시 읽으면
      // 지켜야 할 입력이 다른 문서의 블록으로 갈아치워진다 — 그대로 두고 거부만 알린다.
      // ‼️ 이 검사가 소스 모드 게이트보다 먼저다: 스왑 대상 탭이 마침 소스 모드면
      // 아래 게이트가 closeTaskEdit()으로 draft를 조용히 폐기해 버린다 — 남의 에디터
      // 상태가 내 draft의 생사를 정해서는 안 된다.
      setBlocked("stale");
      return;
    }
    if (isActiveTabSourceMode()) {
      // 소스 모드에서는 이 모달의 저장이 화면 밖 PM에만 닿아 소스 버퍼와 갈라진다 —
      // 변환이 말이 되지 않는 자리(코드블록·제목·표)와 같은 계약으로, 열지 않는다.
      closeTaskEdit();
      return;
    }
    const found = resolveTaskEditTarget(editor);
    if (!found || !editor) {
      // 변환이 말이 되지 않는 자리다(코드블록·제목·표). 조용히 닫는다 — 아무 일도
      // 하지 않는 것이 이 자리의 약속이다.
      closeTaskEdit();
      return;
    }
    const line = readTargetLine(editor.state, found);
    const read = readTaskLine(line);
    ownerRef.current = editor;
    setTarget(found);
    setDraft(read);
    setBlocked(null);
    setDateText(
      Object.fromEntries(DATE_KINDS.map((k) => [k, read.dates[k] ?? ""])),
    );
    setTagText(read.tags.join(", "));
  }, [taskEditOpen, editor, closeTaskEdit]);

  /** 지금 폼이 뜻하는 줄. 미리보기와 저장이 **같은 함수**를 본다. */
  const preview = useMemo(() => (draft ? writeTaskLine(draft) : ""), [draft]);

  const commitDate = useCallback((kind: DateKind, raw: string) => {
    setDraft((d) => {
      if (!d) return d;
      const iso = raw.trim() ? resolveDateInput(raw, new Date()) : "";
      // 읽을 수 없는 값은 **버리지 않는다** — 사용자가 친 글자를 지우면 무엇이 잘못됐는지
      // 볼 수 없다. 필드만 그대로 두고, 저장 시 미리보기에 반영되지 않는 것으로 드러난다.
      if (iso === null) return d;
      return { ...d, dates: { ...d.dates, [kind]: iso } };
    });
  }, []);

  const save = useCallback(() => {
    if (!editor || !target || !draft) return;
    // 이슈 498 (감사 MAJOR): 활성 에디터 인스턴스가 캡처 때와 다르면 이 target은
    // 다른 문서의 좌표다 — identity 가드가 잡기 전에 여기서 먼저 거른다. 소스 모드
    // 게이트보다도 먼저다: 스왑 대상 탭이 소스 모드면 사유가 "sourceMode"로 잘못
    // 표시된다(진짜 사유는 에디터가 바뀐 것이다).
    if (ownerRef.current !== editor) {
      setBlocked("stale");
      return;
    }
    // 이슈 498 (감사 BLOCKER): 모달이 열린 뒤 소스 모드가 켜졌다. 지금 저장하면
    // 화면 밖 PM에만 적용되고, 소스 버퍼는 옛것이라 복귀 시 덮어써 소실되며
    // 소스 모드 중 Cmd+S는 옛 버퍼를 디스크에 쓴다 — 거부가 유일하게 안전하다.
    if (isActiveTabSourceMode()) {
      setBlocked("sourceMode");
      return;
    }
    // 이슈 498: 문서가 모달 밖에서 바뀌었으면 applyTargetLine이 stale 가드로
    // false를 돌려준다. 그때 닫아 버리면 입력이 조용히 증발하므로, 열어 둔 채
    // 메시지를 띄운다.
    if (!applyTargetLine(editor, target, writeTaskLine(draft))) {
      setBlocked("stale");
      return;
    }
    closeTaskEdit();
  }, [editor, target, draft, closeTaskEdit]);

  if (!taskEditOpen || !draft) return null;

  const badDate = (kind: DateKind): boolean => {
    const raw = (dateText[kind] ?? "").trim();
    return raw !== "" && resolveDateInput(raw, new Date()) === null;
  };

  return (
    <div className="task-edit-overlay" onMouseDown={closeTaskEdit}>
      <div
        className="task-edit-dialog"
        onKeyDown={(e) => {
          if (e.key === "Escape") closeTaskEdit();
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) save();
        }}
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
      >
        <div className="flex-header task-edit-header">
          <h2>
            {t(target?.isTask ? "tasks.edit.title" : "tasks.edit.create")}
          </h2>
          <button
            aria-label={t("common.close")}
            className="icon-btn"
            onClick={closeTaskEdit}
          >
            <X size={16} />
          </button>
        </div>

        <label className="task-edit-field">
          <span>{t("tasks.edit.body")}</span>
          <input
            autoFocus
            className="settings-input"
            onChange={(e) =>
              setDraft((d) => (d ? { ...d, body: e.target.value } : d))
            }
            value={draft.body}
          />
        </label>

        <div className="task-edit-dates">
          {DATE_KINDS.map((kind) => (
            <label className="task-edit-field" key={kind}>
              <span>{t(`tasks.edit.date.${kind}`)}</span>
              <input
                aria-invalid={badDate(kind)}
                className={`settings-input${badDate(kind) ? "is-invalid" : ""}`}
                onBlur={() => commitDate(kind, dateText[kind] ?? "")}
                onChange={(e) => {
                  setDateText((s) => ({ ...s, [kind]: e.target.value }));
                  commitDate(kind, e.target.value);
                }}
                placeholder={t("tasks.edit.date.placeholder")}
                value={dateText[kind] ?? ""}
              />
            </label>
          ))}
        </div>

        <label className="task-edit-field">
          <span>{t("tasks.edit.priority")}</span>
          <select
            className="settings-select"
            onChange={(e) =>
              setDraft((d) =>
                d ? { ...d, priority: Number(e.target.value) } : d,
              )
            }
            value={draft.priority}
          >
            {PRIORITY_OPTIONS.map((o) => (
              <option key={o.weight} value={o.weight}>
                {t(o.key)}
              </option>
            ))}
          </select>
        </label>

        <label className="task-edit-field">
          <span>{t("tasks.edit.tags")}</span>
          <input
            className="settings-input"
            onChange={(e) => {
              setTagText(e.target.value);
              setDraft((d) =>
                d
                  ? {
                      ...d,
                      tags: e.target.value
                        .split(",")
                        .map((s) => s.trim())
                        .filter(Boolean),
                    }
                  : d,
              );
            }}
            placeholder={t("tasks.edit.tags.placeholder")}
            value={tagText}
          />
        </label>

        {blocked && (
          <div className="task-edit-stale" role="alert">
            {t(
              blocked === "sourceMode"
                ? "tasks.edit.sourceModeDoc"
                : "tasks.edit.staleDoc",
            )}
          </div>
        )}

        {/* 이 줄이 이 모달의 절반이다 — 사용자는 여기서 이모지 문법을 배운다. */}
        <div className="task-edit-preview">
          <span className="task-edit-preview-label">
            {t("tasks.edit.preview")}
          </span>
          <code>{`- [${TASK_STATE_MARKER[target?.state ?? "todo"]}] ${preview}`}</code>
        </div>

        <div className="task-edit-actions">
          <button className="settings-key-toggle" onClick={closeTaskEdit}>
            {t("common.cancel")}
          </button>
          <button className="task-edit-save" disabled={!preview} onClick={save}>
            {t("common.save")}
          </button>
        </div>
      </div>
    </div>
  );
}

/** 이슈 498: 활성 탭이 소스 모드인가 — 여는 게이트와 저장 게이트가 같은 판정을 본다. */
function isActiveTabSourceMode(): boolean {
  const { activeTabId, sourceModeTabs } = useEditorStore.getState();
  return activeTabId !== null && sourceModeTabs.includes(activeTabId);
}
