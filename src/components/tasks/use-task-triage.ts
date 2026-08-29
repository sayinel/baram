// §312 아젠다 네 판정의 배선 — 행이 올려 보낸 항목 id를 `runTaskTriageAction`으로 넘기고,
// 체크박스가 부르는 체크 판정을 같은 컨텍스트로 실행한다.
//
// 체크 판정이 여기 있는 이유(MODERATE-3): 패널이 그 회계를 손으로 한 벌 더 갖고 있었다 —
// 같은 try/catch, 같은 세 갈래, 그리고 하드코딩된 영어 실패 문구. 같은 실패에 메뉴는
// 한국어로 체크박스는 영어로 답하고 있었고, 회계가 두 벌이면 한쪽만 고쳐지는 것은 시간
// 문제였다. 네 판정이 하나의 컨텍스트와 하나의 회계(`writeAndReconcile`)를 공유한다.
//
// `use-reschedule-overdue.ts`와 같은 이유로 패널에서 뽑아 뒀다(패널이 ~300줄 가이드라인
// 위에 있다).
import { useCallback, useMemo } from "react";

import type { TaskEntry } from "../../ipc/types";
import type { TaskTriageContext } from "../../utils/tasks/task-triage";
import type { Editor } from "@tiptap/react";

import { useTranslation } from "../../i18n/useTranslation";
import {
  runTaskTriageAction,
  toggleTaskState,
} from "../../utils/tasks/task-triage";

export interface TaskTriageOptions {
  /** §305 라우터가 "활성 + dirty" 탭을 판정하는 데 쓴다 — 없으면 디스크로 간다. */
  editor: Editor | null;
  exclude: string[];
  /**
   * 상대 날짜의 기준. 라이브 `new Date()`가 아니라 **패널이 보고 있는 그 날**이어야
   * 한다 — 밤새 열어 둔 패널에서 "오늘로"가 화면의 버킷 경계와 하루 어긋난 날짜를
   * 적는 것이 I4가 막은 바로 그 실패다. 체크 판정의 ✅ 날짜도 같은 값을 쓴다.
   */
  now: Date;
  /** §303 완료 시 ✅날짜를 남길지 — 체크 판정만 쓴다. */
  recordDoneDate: boolean;
}

export interface TaskTriageWiring {
  /** 체크 판정 — 체크박스와 `x` 키가 함께 부른다. */
  onToggle: (task: TaskEntry) => void;
  /** 나머지 세 판정 — 메뉴 항목과 t·s·Del 키가 id를 올려 보낸다. */
  onTriage: (task: TaskEntry, action: string) => void;
}

export function useTaskTriage({
  editor,
  exclude,
  now,
  recordDoneDate,
}: TaskTriageOptions): TaskTriageWiring {
  const { t } = useTranslation();

  const context: TaskTriageContext = useMemo(
    () => ({ editor, exclude, now, t }),
    [editor, exclude, now, t],
  );

  const onToggle = useCallback(
    (task: TaskEntry) => {
      void toggleTaskState(task, recordDoneDate, context);
    },
    [context, recordDoneDate],
  );

  const onTriage = useCallback(
    (task: TaskEntry, action: string) => {
      void runTaskTriageAction(action, task, context);
    },
    [context],
  );

  return useMemo(() => ({ onToggle, onTriage }), [onToggle, onTriage]);
}
