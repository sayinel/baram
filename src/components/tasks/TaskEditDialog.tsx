// M2-b4 태스크 편집 모달 — 입력 규칙을 외우지 않아도 되는 하나의 길.
//
// 이 화면의 절반은 **가르치는 일**이다. 아래 미리보기가 폼을 고칠 때마다 결과 줄을
// 그대로 보여 주므로, 사용자는 `📅2026-08-30`이 어디서 오는지 보면서 배운다. 그래서
// 미리보기는 장식이 아니라 이 모달이 존재하는 이유의 절반이다(§18.15).

import { useCallback, useEffect, useMemo, useState } from "react";

import type { TaskEditTarget } from "../../utils/tasks/task-edit-target";
import type { DateKind, TaskLineDraft } from "../../utils/tasks/task-line-edit";

import { X } from "lucide-react";
import { useShallow } from "zustand/shallow";

import { useEditorContext } from "../../contexts/editor-context";
import { useTranslation } from "../../i18n/useTranslation";
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
  // 날짜는 입력 중인 글자를 그대로 들고 있는다 — `t`/`+3`을 치는 동안 ISO로 바꿔 버리면
  // 두 글자를 칠 수 없다. 확정은 blur와 저장 시점에 한다.
  const [dateText, setDateText] = useState<Record<string, string>>({});
  const [tagText, setTagText] = useState("");

  useEffect(() => {
    if (!taskEditOpen) return;
    const found = resolveTaskEditTarget(editor);
    if (!found || !editor) {
      // 변환이 말이 되지 않는 자리다(코드블록·제목·표). 조용히 닫는다 — 아무 일도
      // 하지 않는 것이 이 자리의 약속이다.
      closeTaskEdit();
      return;
    }
    const line = readTargetLine(editor.state.schema, found);
    const read = readTaskLine(line);
    setTarget(found);
    setDraft(read);
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
    applyTargetLine(editor, target, writeTaskLine(draft));
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

        {/* 이 줄이 이 모달의 절반이다 — 사용자는 여기서 이모지 문법을 배운다. */}
        <div className="task-edit-preview">
          <span className="task-edit-preview-label">
            {t("tasks.edit.preview")}
          </span>
          <code>{`- [${target?.checked ? "x" : " "}] ${preview}`}</code>
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
