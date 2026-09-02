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
import { useEditorStore } from "../stores/editor/editor";
import { useFileStore } from "../stores/file/file";
import { refreshFileTasksInScope } from "../stores/tasks/task-store";
import { serializeLiveDoc } from "../utils/editor/serialize-live-doc";
import { isUnderRoot, normalizePath } from "../utils/path-utils";
import {
  markSourceTabDirty,
  resolveTaskWriteTarget,
} from "../utils/tasks/apply-task-write";
import { resolveDateInput } from "../utils/tasks/task-date-input";
import { orderFields } from "../utils/tasks/task-field-order";
import {
  DATE_FIELDS,
  PRIORITY_DIGITS,
  PRIORITY_EMOJI,
  TRIGGER_BOUNDARY,
  TRIGGER_END,
} from "../utils/tasks/task-field-tokens";
import { DEFAULT_CAPTURE_FILE, tasksRootOf } from "../utils/tasks/tasks-home";

/** UI가 원인별 문구를 고를 수 있게 하는 코드 — 문구 자체는 i18n이 갖는다. */
export type CaptureErrorCode =
  "dirtyTab" | "emptyBody" | "noTasksHome" | "notMarkdown" | "outsideHome";

interface CaptureOptions {
  body: string;
  /** 설정 `tasksCaptureFile` — `{tasksHome}/tasks/` **안**의 이름이다 */
  captureFile: string;
  editor: Editor | null;
  /** 다이얼로그 태그 칸의 값 — `#` 없이. 캡처 줄에 인라인 태그로 접어 넣는다. */
  tags?: string[];
  /** §312.1 해석된 태스크 홈(`resolveTasksHome`). 활성 컨텍스트 루트가 **아니다** */
  tasksHome: string;
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

// 실제 마크다운 체크박스는 대시/별표/플러스 뒤에 공백이 없어도 성립한다(GFM은 요구하지만
// 사람이 손으로 치면 자주 빠진다) — `\s*`로 느슨하게 잡는다. 대괄호 안은 ` `/`x`/`X`만
// 허용해 `[1]` 같은 필드 참조 표기까지 지워버리지 않는다(§18.18 M4가 `/`·`-`를
// 더했지만 집합은 여전히 닫혀 있다 — 그 둘도 체크박스다).
const CHECKBOX_RE = /^\s*[-*+]\s*\[[ xX/-]\]\s+/;
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
/** `![alt](src)` — 앞의 `!`만 떼면 링크가 된다. */
const MARKDOWN_IMAGE_RE = /!(\[[^\]]*\]\([^)]*\))/g;
/** 폭이 지정된 이미지의 직렬화 형태. */
const HTML_IMAGE_RE = /<img\s[^>]*\/?>/g;
/**
 * 하드 브레이크의 `\` 철자 — 줄 끝의 백슬래시와 그 줄바꿈.
 *
 * ‼️ `collapse`는 마크다운을 모르는 순수 문자열 처리다(`/\s+/g` → `" "`). 하드
 * 브레이크의 **의미가 줄 경계 자체**이므로, 줄바꿈만 접히면 그 앞의 `\`가 홀로
 * 남아 파일에 그대로 적힌다 — 사용자가 한글을 치고 ⌘↩ 하면 `inbox.md`의 줄이
 * `\`로 끝나던 결함이 이것이다.
 *
 * ‼️ **줄바꿈이 이미 사라진 뒤에도** 잡아야 한다. `getMarkdown()`은
 * `serializeLiveDoc(editor).trim()`이므로, 본문 **끝**의 하드 브레이크는
 * `태스크 테스트\`로 — 백슬래시 뒤에 아무것도 없이 — 도착한다. 처음 이 패턴은
 * 줄바꿈을 필수로 요구해서 그 경우에 **한 번도 발동하지 못했고**, 사용자가 같은
 * 결함을 두 번 보고했다. 그래서 끝을 `$`로도 받는다 — 이 정규식이 상류의
 * `.trim()` 유무에 의존하지 않아야 한다.
 *
 * 그 대가는 명시해 둔다: 사용자가 **정말로** 백슬래시로 끝나는 글을 쓰면 그 하나가
 * 사라진다. 산문 끝의 홀로 선 백슬래시는 거의 언제나 하드 브레이크의 잔해이고,
 * 남겨 두는 쪽이 지금까지의 결함이었다. 문장 가운데의 백슬래시(`C:\Users\me`)는
 * 건드리지 않는다 — 테스트가 그것을 고정한다.
 *
 * ‼️ 하드 브레이크의 **다른 철자**(줄 끝 공백 두 개 이상)는 여기서 다루지 않는다 —
 * 다룰 필요가 없기 때문이다. 그쪽은 전부 공백이라 `collapse`가 이미 올바르게
 * 접는다. 처음에는 "두 철자가 같은 뜻이니 함께"라며 `[ \t]{2,}`를 넣었는데,
 * 뮤테이션이 그것을 빼도 아무 테스트가 실패하지 않음을 보여 줬다 — 구분할 수 없는
 * 분기는 죽은 코드다. 두 철자가 같은 결과를 낸다는 것은 여전히 테스트가 단정하지만,
 * 그 테스트는 이 패턴을 지키지 않는다(공백 쪽은 `collapse`가 지킨다).
 *
 * 그래서 `collapse` **앞에서** 공백으로 바꾼다. `normalizeBody`가 `collapse`를 두 번
 * 부르므로(안쪽 → 바깥쪽) 안쪽보다 먼저 처리해야 두 번째 패스가 되돌리지 못한다.
 *
 * ‼️ 여기서 고치는 것은 하드 브레이크뿐이다. 한 줄로 접히면서 흔적을 남기는 구성은
 * 더 있지만(`# `, `> `, `- `, `---`, 코드 펜스, 표 구분행, 각주 정의) 그것들은
 * **사용자가 실제로 입력한 문자**다. 이 파일의 `takeToken`이 이미 같은 선을 긋는다:
 * 해석되지 않는 토큰은 그대로 둔다 — 조용히 지우지 않는다. 하드 브레이크는 문자가
 * 아니라 공백 의미이므로 공백으로 바꾸는 것이 충실한 변환이고, `#`를 지우는 것은
 * 사용자의 글자를 지우는 것이다. 조사 결과는 리포트에 표로 남겼다.
 */
const HARD_BREAK_RE = /\\(?:\r?\n|$)/g;

/** POSIX 절대 경로와 Windows 드라이브 문자 — 수집함 설정에는 둘 다 올 수 없다. */
const ABSOLUTE_RE = /^(?:\/|[A-Za-z]:[/\\])/;

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
  // §324-e 태스크는 **한 줄**이므로 이미지는 링크가 된다 — 근거는
  // `imagesToLinks`의 주석에. 여기서 부르는 이유는 이 함수를 통과하지 않고
  // 태스크 줄이 만들어지는 경로가 없어야 하기 때문이다(호출부에 맡기면 다음
  // 호출부가 그것을 잊는다).
  const normalized = normalizeBody(imagesToLinks(body).text);
  const { fields, text } = extractFields(normalized, isoToLocalDate(today));
  if (!text) return null;
  // §303 표 순서로 정렬한다. 이 줄이 없으면 `extractFields`가 우선순위를 먼저 담고
  // `➕`가 맨 뒤에 붙어 canonical 순서를 어긴다 — 두 파서가 다 읽어내므로 손상은
  // 아니지만, 같은 vault를 Obsidian과 함께 쓰는 사용자에게는 보이는 드리프트다.
  const parts = [
    text,
    ...inlineTags(tags, text),
    ...orderFields([...fields, `➕${today}`]),
  ];
  return `- [ ] ${parts.join(" ")}`;
}

/**
 * §324-e 마크다운 이미지를 **링크**로 바꾼다. 바뀐 개수도 돌려준다 — 호출부가
 * 사용자에게 알려야 하기 때문이다(이미지를 넣었는데 링크가 되는 것은 조용히
 * 일어나서는 안 된다).
 *
 * ‼️ 왜 링크인가. 태스크는 `- [ ] {내용}` **한 줄**이고(§18), 아젠다도 태스크당 한
 * 줄을 보여 준다. 이미지 노드는 `group: "block"`이므로(`extensions/nodes/image.ts`)
 * 한 줄 안에 인라인으로 살 자리가 없다. 링크는 인라인이라 그 계약이 유지되고,
 * 파일은 라운드트립을 견딘다.
 *
 * ‼️ 관측 사실과 추정을 구분해 적는다. 사용자는 "편집 모드를 드나든 뒤 세 줄로
 * 갈라진다"고 보고했다. 나는 그 분할을 **재현하지 못했다** — 파이프라인
 * 라운드트립, 파일 전체 파싱, 실제 `Editor` 인스턴스, 4회 반복 순환 모두에서
 * 이미지는 `taskItem > paragraph > [text, image, text]`로 인라인에 남고 한 줄로
 * 다시 직렬화됐다. 그러므로 "파싱이 이미지를 문단 밖으로 밀어낸다"는 설명은
 * 사실이 아니다.
 *
 * 가장 그럴듯한 실제 기제는 **DOM**이다: 이미지 NodeView는 `<div>`를 그리고, 그것이
 * `<p>` 안에 들어가면 HTML 파서가 문단을 쪼갠다(`<div>`는 `<p>`의 자손이 될 수
 * 없다). DOM을 다시 읽는 경로가 있으면 그 분할이 문서에 반영된다. jsdom의 맨
 * `Editor`는 React NodeView를 만들지 않으므로 이 검증은 실물에서만 가능하다.
 * 어느 기제든 **링크로 바꾸면 사라진다** — `<a>`는 `<p>` 안에서 유효하다.
 *
 * 두 형태를 모두 다룬다: `![alt](src)`와, 폭이 지정됐을 때 직렬화되는
 * `<img src=… alt=…>`(`pipeline/transformers/image-transformer.ts`). alt는 링크
 * 텍스트로 그대로 옮긴다 — 사용자가 보는 이름이다.
 */
export function imagesToLinks(text: string): {
  converted: number;
  text: string;
} {
  let converted = 0;
  let out = text.replace(MARKDOWN_IMAGE_RE, (_all, rest: string) => {
    converted++;
    return rest;
  });
  out = out.replace(HTML_IMAGE_RE, (all: string) => {
    const src = /\ssrc\s*=\s*"([^"]*)"/.exec(all)?.[1];
    if (!src) return all;
    const alt = /\salt\s*=\s*"([^"]*)"/.exec(all)?.[1] ?? "";
    converted++;
    return `[${alt}](${src})`;
  });
  return { converted, text: out };
}

/** 한 줄을 수집함에 붙이고 그 줄의 원문을 돌려준다. */
export async function captureTask(opts: CaptureOptions): Promise<string> {
  const { body, captureFile, editor, tags, tasksHome, today } = opts;
  const line = buildCaptureLine(body, today, tags);
  if (line === null) {
    // `body.trim()`만 보면 "➕2026-01-01"처럼 정규화 뒤에야 비는 본문을 놓쳐,
    // 수집함에 지울 수 없는 빈 행이 생긴다(리뷰 Minor 2).
    throw new CaptureError("emptyBody", "captureTask: body is empty");
  }
  const path = resolveCapturePath(tasksHome, captureFile);

  const target = resolveTaskWriteTarget(path, editor);

  // §312 소스 모드 탭 — 화면에 보이고 저장이 실제로 쓰는 권위 있는 텍스트는 CodeMirror
  // 버퍼다(`handleSave`, use-file-operations.ts:231-232). 정리 조작 셋은 이미 그 버퍼에
  // 쓴다(`writeToSourceBuffer`·`deleteFromSourceBuffer`); 캡처만 다른 곳으로 보내면 다음
  // 저장이 붙인 줄을 덮어 지운다. 라이브 문서든 디스크든 결과는 같다.
  //
  // ‼️ 디스크로 보내는 것으로는 충분하지 않았다. 그 관문(`assertNoUnsavedTab`)은
  // `tab.isDirty`로 판정하는데, 마크다운 소스 모드 타이핑은 일부러 dirty를 세우지
  // 않으므로(`tab-surface-renderers.tsx:108`) 저장하지 않은 글을 들고 있는 탭이
  // **clean으로 보이고** 그대로 통과했다.
  if (target.kind === "source" && appendToSourceBuffer(target.tabId, line)) {
    return line;
  }

  // ‼️ `!== "document"`이지 `=== "disk"`가 아니다. 위에서 버퍼에 붙이지 못한 `source`도
  // 여기로 흘러야 한다 — 라이브 문서에 붙이면 저장 시점에 버퍼가 그 줄을 통째로 지운다.
  //
  // 여기 도달하는 경우는 셋이고, **그 셋 모두에서 `assertNoUnsavedTab`의 판정이 정직하다**:
  // - 탭이 없는 파일 — 디스크가 유일한 진실원이다.
  // - 소스 모드가 아닌 탭 — WYSIWYG 표면의 `isDirty`는 Tiptap `update`가 세우므로 참이다.
  // - 소스 모드지만 접근자 미등록 — 버퍼를 소유한 `useSourceMode`(App 수명)가 마운트돼
  //   있지 않다는 뜻이라 나중에 디스크를 덮어쓸 버퍼가 존재하지 않는다. 저장 경로도 같은
  //   접근자를 쓰므로 그 상태에서는 저장 자체가 일어날 수 없다.
  //
  // `isDirty`가 거짓말하는 유일한 경우(마크다운 소스 모드 타이핑)는 위에서 갈라져 나갔다.
  if (target.kind !== "document" || !editor) {
    assertNoUnsavedTab(path);
    const raw = await appendTaskLine(path, line);
    // §312.1 수집함이 **태스크 홈**으로 옮겨가면서 이 줄이 필요해졌다. 종전에는 캡처가
    // 언제나 활성 vault 안에 썼으므로 파일 워처가 곧바로 그 파일을 다시 읽었다. 태스크
    // 홈은 컨텍스트로 열려 있지 않을 수 있고, 그러면 감시 루트 밖이라 `file:changed`가
    // 오지 않는다 — 방금 잡은 태스크가 아젠다에 뜨지 않는다.
    //
    // 위 관문들을 통과한 갈래이므로 이 파일에는 저장되지 않은 표면이 없다. 디스크를 다시
    // 읽어도 잃을 것이 없다.
    await refreshFileTasksInScope(path);
    return raw;
  }

  // 열린 문서 경로 — 소스는 라이브 문서다. `openFiles`는 사용자의 첫 타이핑
  // 이후 영구히 낡으므로 읽으면 안 된다(M2-a Critical 1).
  const content = serializeLiveDoc(editor);
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
 * 캡처 파일의 절대 경로.
 *
 * `normalizePath`로 합치고 정리한다 — 손으로 문자열을 이어 붙이면 홈의 트레일링 슬래시가
 * `//`를 만들고(§260 Phase 4a LOW-4와 같은 종류의 결함 — `resolveTaskWriteTarget`은 경로를
 * 문자열로 정확히 비교한다), `./`처럼 정리되지 않은 세그먼트도 그대로 남는다. 설정값이 빈
 * 문자열이면(입력창을 지우는 중일 수 있다) 디렉터리 경로로 미끄러지는 대신 기본 파일명으로
 * 대체한다.
 *
 * ‼️ 설정값은 `tasks/` **안의 이름**이지 홈 기준 경로가 아니다(§312.1). 규칙이 이미
 * `tasks/`인데 설정이 그 폴더를 되풀이하게 두면 값이 서브트리 밖을 가리킬 수 있고, 그러면
 * §312 불가침 규칙의 화이트리스트에 "수집함은 예외" 조항이 영영 남는다. 절대 경로도 `..`로
 * 빠져나가는 값도 여기서 걸린다 — 아래 `isUnderRoot`가 그 판정이다.
 *
 * 서브트리 밖과 비마크다운은 **거절한다**(리뷰 Major 5). 둘 다 append 자체는 성공하고
 * 다이얼로그는 오류 없이 닫히지만, 스캔은 루트 아래만 걷고 워처는 감시 루트 아래 마크다운
 * 이벤트만 들으므로 그 태스크는 어느 버킷에도 영영 나타나지 않는다.
 * `notes/`처럼 디렉터리로 적은 값도 여기서 걸린다 — 트레일링 슬래시를 뗀 `notes`는
 * `.md`가 아니고, 그대로 두면 `append_line`이 **`notes`라는 이름의 파일**을 만든다.
 *
 * §312 아카이브도 이 함수를 쓴다(`useArchiveDone`). 수집함이 어디인지는 캡처와 배수구가
 * 반드시 같은 답을 내야 하는 사실이다 — 갈라지면 아카이브의 화이트리스트가 캡처가 쓰는
 * 파일을 알아보지 못해 조용히 아무것도 옮기지 못한다.
 *
 * §312.1: 기준이 활성 컨텍스트 루트에서 **태스크 홈**으로 바뀌었다. 그래서 컨텍스트를
 * 바꿔도 수집함은 같은 자리다.
 */
export function resolveCapturePath(
  tasksHome: string,
  captureFile: string,
): string {
  const file = captureFile.trim() === "" ? DEFAULT_CAPTURE_FILE : captureFile;
  const root = normalizePath(tasksRootOf(tasksHome));
  // ‼️ 절대 경로는 **거절한다**, 상대 경로로 다시 읽지 않는다. 이어 붙이면 `/elsewhere/x.md`가
  // 조용히 `{tasks}/elsewhere/x.md`가 되어, 사용자가 적은 자리도 아니고 적었다는 사실을 알
  // 방법도 없는 파일이 생긴다. 이 설정은 `tasks/` 안의 이름이라고 말했으므로, 아닌 값에는
  // 그렇게 답한다.
  if (ABSOLUTE_RE.test(file)) {
    throw new CaptureError(
      "outsideHome",
      `capture file must be a name inside the tasks subtree, not an absolute path: ${file}`,
    );
  }
  const path = normalizePath(`${root}/${file}`);
  if (!isUnderRoot(path, root)) {
    throw new CaptureError(
      "outsideHome",
      `capture file escapes the tasks subtree: ${path}`,
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
 * §312 소스 버퍼 끝에 캡처 줄을 붙이고 그 탭을 dirty로 세운다.
 *
 * `false`는 "접근자 미등록" — 표면 하나가 아니라 버퍼를 소유한 `useSourceMode` 자체가
 * 마운트돼 있지 않다는 뜻이다. 쓸 버퍼가 존재하지 않으므로 호출자가 디스크로 폴백한다
 * (`applyTaskWrite`·`applyTaskDelete`가 쓰는 것과 같은 신호).
 *
 * 구분자 계산은 라이브 문서 경로와 같다 — 끝 개행이 없는 버퍼에 그냥 이으면 캡처가 앞
 * 줄에 붙어 태스크가 아니라 그 줄의 꼬리가 된다.
 *
 * `markSourceTabDirty`를 부르는 이유는 정리 조작과 같다: 표시가 없으면 버퍼에만 있는 이
 * 줄이 사용자에게 흔적을 남기지 않는다 — 저장하지 않고 닫아도 확인을 받지 못하고, 외부
 * 변경이 오면 충돌 모달 대신 조용한 자동 리로드 경로로 간다.
 */
function appendToSourceBuffer(tabId: string, line: string): boolean {
  const access = useEditorStore.getState().sourceBufferAccess;
  if (!access) return false;

  const content = access.getSourceBuffer(tabId);
  const sep = content.length > 0 && !content.endsWith("\n") ? "\n" : "";
  access.setSourceBuffer(tabId, `${content}${sep}${line}\n`);
  markSourceTabDirty(tabId);
  return true;
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
 *
 * ‼️ 이 관문은 소스 모드 탭을 판정하지 못한다 — `isDirty`는 마크다운 소스 타이핑에
 * 세워지지 않으므로 그 탭에서는 거짓말이다. 그래서 소스 판정은 여기 오기 **전에**
 * `appendToSourceBuffer`가 가져간다. 여기 남는 것은 `isDirty`가 참인 경우들뿐이다.
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
    collapse(body.replace(HARD_BREAK_RE, " "))
      .replace(CHECKBOX_RE, "")
      .replace(CREATED_DATE_RE, "")
      .replace(BARE_CREATED_RE, ""),
  );
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
