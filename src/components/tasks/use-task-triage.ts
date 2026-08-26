// §312 정리 메뉴의 액션 배선 — 행이 올려 보낸 항목 id를 `runTaskTriageAction`으로
// 넘긴다. `use-reschedule-overdue.ts`와 같은 이유로 패널에서 뽑아 뒀다(패널이 이미
// ~300줄 가이드라인 위에 있다). Task 3·4가 조작을 더해도 패널은 그대로다.
import { useCallback, useMemo } from "react";

import type { TaskEntry } from "../../ipc/types";
import type { TaskTriageContext } from "../../utils/tasks/task-triage";
import type { Editor } from "@tiptap/react";

import { useTranslation } from "../../i18n/useTranslation";
import { runTaskTriageAction } from "../../utils/tasks/task-triage";

export interface TaskTriageOptions {
  /** §305 라우터가 "활성 + dirty" 탭을 판정하는 데 쓴다 — 없으면 디스크로 간다. */
  editor: Editor | null;
  exclude: string[];
  /**
   * 상대 날짜의 기준. 라이브 `new Date()`가 아니라 **패널이 보고 있는 그 날**이어야
   * 한다 — 밤새 열어 둔 패널에서 "오늘로"가 화면의 버킷 경계와 하루 어긋난 날짜를
   * 적는 것이 I4가 막은 바로 그 실패다.
   */
  now: Date;
  rootPath: null | string;
}

export function useTaskTriage({
  editor,
  exclude,
  now,
  rootPath,
}: TaskTriageOptions): (task: TaskEntry, action: string) => void {
  const { t } = useTranslation();

  const context: TaskTriageContext = useMemo(
    () => ({ editor, exclude, now, rootPath, t }),
    [editor, exclude, now, rootPath, t],
  );

  return useCallback(
    (task: TaskEntry, action: string) => {
      void runTaskTriageAction(action, task, context);
    },
    [context],
  );
}
