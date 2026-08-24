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
import { normalizePath, stripTrailingSeparators } from "../utils/path-utils";
import { resolveTaskWriteTarget } from "../utils/tasks/apply-task-write";

interface CaptureOptions {
  body: string;
  /** 설정 `tasksCaptureFile` — 상대 경로면 `rootPath` 기준 */
  captureFile: string;
  editor: Editor | null;
  rootPath: string;
  today: string;
}

/** 설정값이 비었을 때(사용자가 입력창을 비우는 중일 수 있다) 쓸 기본 파일명. */
const DEFAULT_CAPTURE_FILE = "Inbox.md";

// 실제 마크다운 체크박스는 대시/별표/플러스 뒤에 공백이 없어도 성립한다(GFM은 요구하지만
// 사람이 손으로 치면 자주 빠진다) — `\s*`로 느슨하게 잡는다. 대괄호 안은 ` `/`x`/`X`만
// 허용해 `[1]` 같은 필드 참조 표기까지 지워버리지 않는다.
const CHECKBOX_RE = /^\s*[-*+]\s*\[[ xX]\]\s+/;
// Rust 파서(`parse.rs`)는 본문에서 처음 만나는 `➕`를 생성일로 읽는다 — 캡처 전에 이미
// 박혀 있던 마커를 지우지 않으면 방금 붙인 오늘 날짜보다 그 마커가 먼저 읽혀 생성일이
// 조용히 뒤바뀐다(§312 리뷰 Medium 1).
const CREATED_DATE_RE = /➕\s*\d{4}-\d{2}-\d{2}/g;

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
  // 본문에 이미 생성일 마커가 있으면 지운다 — 그대로 두면 두 마커가 한 줄에 남고
  // Rust 파서는 앞선(=사용자가 입력한) 쪽을 생성일로 읽는다.
  const withoutCreated = withoutBox
    .replace(CREATED_DATE_RE, "")
    .replace(/\s+/g, " ")
    .trim();
  return `- [ ] ${withoutCreated} ➕${today}`;
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

/**
 * 캡처 파일의 절대 경로. 설정값이 이미 절대 경로면 그대로 쓴다.
 *
 * `stripTrailingSeparators`/`normalizePath`로 합치고 정리한다 — 손으로 문자열을 이어
 * 붙이면 `rootPath`의 트레일링 슬래시가 `//`를 만들고(§260 Phase 4a LOW-4와 같은
 * 종류의 결함 — `resolveTaskWriteTarget`은 경로를 문자열로 정확히 비교한다),
 * `./`처럼 정리되지 않은 세그먼트도 그대로 남는다. 설정값이 빈 문자열이면(입력창을
 * 지우는 중일 수 있다) 디렉터리 경로로 미끄러지는 대신 기본 파일명으로 대체한다.
 */
function resolveCapturePath(rootPath: string, captureFile: string): string {
  const file = captureFile.trim() === "" ? DEFAULT_CAPTURE_FILE : captureFile;
  const joined = file.startsWith("/")
    ? file
    : `${stripTrailingSeparators(rootPath)}/${file}`;
  return normalizePath(joined);
}
