// §312 태스크 캡처 — 문맥 없는 TODO가 착지할 자리 하나.
//
// 쓰기 대상 판정은 M2-a의 `resolveTaskWriteTarget`을 그대로 쓴다. 수집함 파일이
// 더티 활성 탭이면 디스크 append가 저장 시 덮여 사라지기 때문이다 — M2-a가 방금
// 닫은 것과 같은 구멍이라 라우팅 규칙을 두 벌로 만들지 않는다.

import type { Editor } from "@tiptap/react";

import { appendTaskLine } from "../ipc/invoke";
import { prosemirrorToMarkdown } from "../pipeline";
import { useEditorStore } from "../stores/editor/editor";
import { useFileStore } from "../stores/file/file";
import { resolveTaskWriteTarget } from "../utils/tasks/apply-task-write";

interface CaptureOptions {
  body: string;
  /** 설정 `tasksCaptureFile` — 상대 경로면 `rootPath` 기준 */
  captureFile: string;
  editor: Editor | null;
  rootPath: string;
  today: string;
}

const CHECKBOX_RE = /^\s*[-*+]\s+\[[ xX]\]\s+/;

/**
 * 캡처 본문을 태스크 한 줄로 만든다.
 *
 * `➕{today}`를 붙이는 것은 방치 나이 배지의 **유일한** 근거이기 때문이다 —
 * Rust `TaskEntry`에 파일 mtime이 없고, 넣으면 스캔마다 파일당 `metadata()`
 * 호출이 늘어 10k 파일 예산을 갉아먹는다(§18.7 근거 1).
 */
export function buildCaptureLine(body: string, today: string): string {
  // append는 한 줄만 받는다 — 여러 줄 본문은 접는다.
  const flat = body.replace(/\s+/g, " ").trim();
  const withoutBox = flat.replace(CHECKBOX_RE, "");
  return `- [ ] ${withoutBox} ➕${today}`;
}

/** 한 줄을 수집함에 붙이고 그 줄의 원문을 돌려준다. */
export async function captureTask(opts: CaptureOptions): Promise<string> {
  const { body, captureFile, editor, rootPath, today } = opts;
  if (!body.trim()) {
    throw new Error("captureTask: body is empty");
  }
  const path = resolveCapturePath(rootPath, captureFile);
  const line = buildCaptureLine(body, today);

  const target = resolveTaskWriteTarget(path, editor);
  if (target.kind === "disk" || !editor) {
    return appendTaskLine(path, line);
  }

  // 열린 문서 경로 — 소스는 라이브 문서다. `openFiles`는 사용자의 첫 타이핑
  // 이후 영구히 낡으므로 읽으면 안 된다(M2-a Critical 1).
  const content = prosemirrorToMarkdown(editor.state.doc);
  const sep = content.length > 0 && !content.endsWith("\n") ? "\n" : "";
  const next = `${content}${sep}${line}\n`;

  useFileStore.getState().setFileContent(path, next);
  useEditorStore.getState().markDirty(target.tabId, true);
  if (useEditorStore.getState().activeTabId === target.tabId) {
    useEditorStore.getState().requestContentRefresh();
  }
  return line;
}

/** 캡처 파일의 절대 경로. 설정값이 이미 절대 경로면 그대로 쓴다. */
function resolveCapturePath(rootPath: string, captureFile: string): string {
  return captureFile.startsWith("/")
    ? captureFile
    : `${rootPath}/${captureFile}`;
}
