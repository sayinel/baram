// §312 태스크 캡처 — 문맥 없는 TODO가 착지할 자리 하나.
//
// 쓰기 대상 판정은 M2-a의 `resolveTaskWriteTarget`을 그대로 쓴다. 수집함 파일이
// 더티 활성 탭이면 디스크 append가 저장 시 덮여 사라지기 때문이다 — M2-a가 방금
// 닫은 것과 같은 구멍이라 라우팅 규칙을 두 벌로 만들지 않는다.
//
// 실패는 전부 `CaptureError`로 낸다. 캡처가 잃는 것은 다시 누르면 되는 체크
// 토글이 아니라 **다른 어디에도 없는 사용자의 문장**이므로, 보이지 않는 곳에
// 쓰고 성공을 보고하느니 코드를 달아 시끄럽게 실패한다(§312 리뷰 Major 3·5).

import type { Editor } from "@tiptap/react";

import { appendTaskLine } from "../ipc/invoke";
import { prosemirrorToMarkdown } from "../pipeline";
import { useEditorStore } from "../stores/editor/editor";
import { useFileStore } from "../stores/file/file";
import {
  isUnderRoot,
  normalizePath,
  stripTrailingSeparators,
} from "../utils/path-utils";
import { resolveTaskWriteTarget } from "../utils/tasks/apply-task-write";
import { resolveDateInput } from "../utils/tasks/task-date-input";
import {
  DATE_FIELDS,
  PRIORITY_DIGITS,
  PRIORITY_EMOJI,
  TRIGGER_BOUNDARY,
  TRIGGER_END,
} from "../utils/tasks/task-field-tokens";

/** UI가 원인별 문구를 고를 수 있게 하는 코드 — 문구 자체는 i18n이 갖는다. */
export type CaptureErrorCode =
  "dirtyTab" | "emptyBody" | "notMarkdown" | "noVault" | "outsideVault";

interface CaptureOptions {
  body: string;
  /** 설정 `tasksCaptureFile` — 상대 경로면 `rootPath` 기준 */
  captureFile: string;
  editor: Editor | null;
  rootPath: string;
  /** 다이얼로그 태그 칸의 값 — `#` 없이. 캡처 줄에 인라인 태그로 접어 넣는다. */
  tags?: string[];
  today: string;
}

export class CaptureError extends Error {
  readonly code: CaptureErrorCode;

  constructor(code: CaptureErrorCode, message: string) {
    super(message);
    this.name = "CaptureError";
    this.code = code;
  }
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
// 날짜가 붙지 않은 맨 `➕`도 지운다. 파서는 **첫** `➕`만 보고 그 뒤가 유효 날짜가
// 아니면 이모지만 떼고 **재시도하지 않으므로**, 하나만 살아남아도 우리가 붙인
// 생성일이 통째로 무시되고 본문에 날짜 문자열이 그대로 노출된다(리뷰 Minor 1).
const BARE_CREATED_RE = /➕/g;
// 워처(`use-task-watcher.ts:51-53`)와 전체 스캔(`collect_md_files`, `fs/mod.rs:88`)이
// 둘 다 인덱싱하는 확장자. 그 밖의 이름으로 캡처하면 줄은 적히지만 어느 버킷에도 영영
// 나타나지 않는다.
//
// ‼️ `/i`를 붙이면 안 된다. 인덱싱하는 두 곳은 `ends_with(".md")`로 **대소문자를 구분**하므로,
// 여기서만 관대해지면 `Inbox.MD`가 검증을 통과하고 파일에 적히지만 스캔도 워처도 그 파일을
// 걷지 않는다 — 이 게이트가 막으려던 실패 모드 그대로다. 파일 시스템의 대소문자 구분 여부와는
// 무관하다. 걸리는 것은 문자열 비교다.
const MARKDOWN_RE = /\.(?:markdown|md)$/;

/**
 * 캡처 본문을 태스크 한 줄로 만든다. 정규화 후 본문이 비면 `null`.
 *
 * `➕{today}`를 붙이는 것은 방치 나이 배지의 **유일한** 근거이기 때문이다 —
 * Rust `TaskEntry`에 파일 mtime이 없고, 넣으면 스캔마다 파일당 `metadata()`
 * 호출이 늘어 10k 파일 예산을 갉아먹는다(§18.7 근거 1).
 *
 * §307D: `due:`/`sched:`/`start:`와 `!N`/`prio:N`은 에디터가 이미 가르치는
 * 어휘다(`task-field-tokens.ts`). 캡처에서 같은 표기가 문자 그대로 남으면
 * 사용자는 언어를 두 개 배워야 한다 — 저장 시점에 같은 이모지 필드로 바꾼다.
 */
export function buildCaptureLine(
  body: string,
  today: string,
  tags: string[] = [],
): null | string {
  const normalized = normalizeBody(body);
  const { fields, text } = extractFields(normalized, isoToLocalDate(today));
  if (!text) return null;
  const parts = [text, ...inlineTags(tags, text), ...fields, `➕${today}`];
  return `- [ ] ${parts.join(" ")}`;
}

/** 한 줄을 수집함에 붙이고 그 줄의 원문을 돌려준다. */
export async function captureTask(opts: CaptureOptions): Promise<string> {
  const { body, captureFile, editor, rootPath, tags, today } = opts;
  const line = buildCaptureLine(body, today, tags);
  if (line === null) {
    // `body.trim()`만 보면 "➕2026-01-01"처럼 정규화 뒤에야 비는 본문을 놓쳐,
    // 수집함에 지울 수 없는 빈 행이 생긴다(리뷰 Minor 2).
    throw new CaptureError("emptyBody", "captureTask: body is empty");
  }
  const path = resolveCapturePath(rootPath, captureFile);

  const target = resolveTaskWriteTarget(path, editor);
  if (target.kind === "disk" || !editor) {
    assertNoUnsavedTab(path);
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
 * 디스크로 쓰기 직전의 마지막 확인 — 그 파일에 **저장하지 않은 탭**이 있으면
 * 쓰지 않고 던진다.
 *
 * `resolveTaskWriteTarget`은 "활성 + 더티"가 아닌 모든 탭을 디스크로 보낸다.
 * 사용자가 편집한 **배경** 탭도 그렇다. 그 탭으로 돌아오면
 * `use-tab-switching`이 `openFiles`가 아니라 캐시된 `EditorState`를 복원하므로
 * 방금 붙인 줄은 화면에 없고, 다음 저장이 캐시된 버퍼로 파일을 통째로 덮어써
 * 캡처가 사라진다 — 경고도 재시도도 없이.
 *
 * M2-a에서 이 규칙이 잃는 것은 다시 누르면 되는 체크 토글이었다. 여기서 잃는
 * 것은 다른 어디에도 없는 사용자의 문장이다. 그 탭의 캐시된 상태로 손을 뻗지
 * 않는 이유는 그것이 훅의 ref 안에 있어 여기서 닿을 수 없기 때문이다.
 */
function assertNoUnsavedTab(path: string): void {
  const tab = useEditorStore.getState().tabs.find((t) => t.filePath === path);
  if (!tab?.isDirty) return;
  throw new CaptureError(
    "dirtyTab",
    `captureTask: ${path} has unsaved changes in a tab`,
  );
}

function collapse(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** `due:`/`!N` 같은 워드 트리거를 떼어내 canonical 이모지 필드로 바꾼다. */
function extractFields(
  body: string,
  today: Date,
): { fields: string[]; text: string } {
  const fields: string[] = [];

  // 3(보통)은 이모지가 `""`다 — 트리거는 지워지되 마커는 남지 않는다.
  const prio = takeToken(
    body,
    new RegExp(`${TRIGGER_BOUNDARY}${PRIORITY_DIGITS}${TRIGGER_END}`, "g"),
    (digit) => PRIORITY_EMOJI[digit] ?? null,
  );
  let text = prio.text;
  if (prio.value) fields.push(prio.value);

  for (const { trigger, emoji } of DATE_FIELDS) {
    const found = takeToken(
      text,
      new RegExp(`${TRIGGER_BOUNDARY}${trigger}:(\\S+)${TRIGGER_END}`, "g"),
      (raw) => resolveDateInput(raw, today),
    );
    text = found.text;
    if (found.value) fields.push(`${emoji}${found.value}`);
  }

  return { fields, text: collapse(text) };
}

/**
 * 태그 칸의 값을 캡처 줄에 넣을 `#tag` 토큰으로. 본문에 이미 인라인으로 적힌
 * 태그는 건너뛴다 — 파서는 중복을 그대로 두 번 싣는다.
 */
function inlineTags(tags: string[], text: string): string[] {
  const words = new Set(text.split(" "));
  const out: string[] = [];
  for (const raw of tags) {
    const tag = raw.trim().replace(/^#+/, "");
    if (!tag) continue;
    const token = `#${tag}`;
    if (out.includes(token) || words.has(token)) continue;
    out.push(token);
  }
  return out;
}

/** `➕` 스탬프와 같은 로컬 오늘을 `resolveDateInput`이 쓰는 `Date`로. */
function isoToLocalDate(iso: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return new Date();
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** `- [ ] `·`➕date`·맨 `➕`를 떼고 공백을 접은 본문. */
function normalizeBody(body: string): string {
  return collapse(
    collapse(body)
      .replace(CHECKBOX_RE, "")
      .replace(CREATED_DATE_RE, "")
      .replace(BARE_CREATED_RE, ""),
  );
}

/**
 * 캡처 파일의 절대 경로.
 *
 * `stripTrailingSeparators`/`normalizePath`로 합치고 정리한다 — 손으로 문자열을 이어
 * 붙이면 `rootPath`의 트레일링 슬래시가 `//`를 만들고(§260 Phase 4a LOW-4와 같은
 * 종류의 결함 — `resolveTaskWriteTarget`은 경로를 문자열로 정확히 비교한다),
 * `./`처럼 정리되지 않은 세그먼트도 그대로 남는다. 설정값이 빈 문자열이면(입력창을
 * 지우는 중일 수 있다) 디렉터리 경로로 미끄러지는 대신 기본 파일명으로 대체한다.
 *
 * 볼트 밖과 비마크다운은 **거절한다**(리뷰 Major 5). 둘 다 append 자체는 성공하고
 * 다이얼로그는 오류 없이 닫히지만, `get_vault_tasks`는 볼트만 걷고 워처는 감시 루트
 * 아래 마크다운 이벤트만 들으므로 그 태스크는 어느 버킷에도 영영 나타나지 않는다.
 * `notes/`처럼 디렉터리로 적은 값도 여기서 걸린다 — 트레일링 슬래시를 뗀 `notes`는
 * `.md`가 아니고, 그대로 두면 `append_line`이 **`notes`라는 이름의 파일**을 만든다.
 */
function resolveCapturePath(rootPath: string, captureFile: string): string {
  const file = captureFile.trim() === "" ? DEFAULT_CAPTURE_FILE : captureFile;
  const joined = file.startsWith("/")
    ? file
    : `${stripTrailingSeparators(rootPath)}/${file}`;
  const path = normalizePath(joined);
  if (!isUnderRoot(path, normalizePath(rootPath))) {
    throw new CaptureError(
      "outsideVault",
      `capture file is outside the vault: ${path}`,
    );
  }
  if (!MARKDOWN_RE.test(path)) {
    throw new CaptureError(
      "notMarkdown",
      `capture file is not a markdown file: ${path}`,
    );
  }
  return path;
}

/**
 * 패턴에 걸린 토큰 중 **해석되는** 것을 본문에서 떼고 그 첫 값을 돌려준다.
 * 해석 불가한 토큰은 입력 규칙과 같은 판정으로 **그대로 둔다** — 사용자가 친
 * 글자를 조용히 없애지 않는다(`due:내일` 같은 값은 문자 그대로 남는다).
 */
function takeToken(
  text: string,
  pattern: RegExp,
  resolve: (raw: string) => null | string,
): { text: string; value: null | string } {
  let value: null | string = null;
  let kept = "";
  let last = 0;
  for (const m of text.matchAll(pattern)) {
    const resolved = resolve(m[1]);
    if (resolved === null) continue;
    if (value === null) value = resolved;
    kept += text.slice(last, m.index);
    last = m.index + m[0].length;
  }
  return { text: kept + text.slice(last), value };
}
