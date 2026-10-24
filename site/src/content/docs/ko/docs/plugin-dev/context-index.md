---
title: "컨텍스트: 인덱스"
sourceHash: "43844553bb0c"
---

## `context.index` (`files` 또는 `files:readonly` 필요)

파일을 하나씩 읽어 링크를 직접 파싱하는 대신, Baram이 이미 아는 것을 물으십시오 — 어떤 노트가 이 노트를
링크하는지, 이 노트가 어떤 링크를 갖는지, 볼트의 태그와 태스크, 어떤 글이 어디에 있는지입니다. 답은 앱의
백링크 패널, 태그 패널, 태스크 패널, 전역 검색과 같은 링크·태그·태스크·검색 규칙으로, 컨텍스트 하나에서
나옵니다.

```typescript
backlinks(path: string, opts?: IndexOptions): Promise<IndexBacklink[]>;
links(path: string, opts?: IndexOptions): Promise<IndexLink[]>;
notesWithTag(tag: string, opts?: IndexOptions): Promise<string[]>;
search(query: string, opts?: IndexSearchOptions): Promise<IndexSearchResult>;
tags(opts?: IndexOptions): Promise<IndexTag[]>;
tasks(opts?: IndexTaskOptions): Promise<IndexTask[]>;

// IndexOptions       = { context?: string }
// IndexTaskOptions   = IndexOptions & { file?: string; status?: "open" | "done" | "cancelled" | "all" }
// IndexSearchOptions = IndexOptions & { caseSensitive?: boolean; folder?: string;
//                                       limit?: number; regex?: boolean; word?: boolean }
```

권한이 따로 없습니다. `files` 또는 `files:readonly`가 `ctx.index`를 엽니다 — 돌려주는 것은 모두 파일을 읽어
얻을 수 있는 것이기 때문입니다. 둘 다 없으면 trusted 티어는 `ctx.index`에 닿는 순간
`Plugin requires "files" capability…`를 던지고, sandboxed 티어의 호출은 브로커가 거부합니다.

## 경로와 컨텍스트

경로는 티어의 파일 경로 규칙을 따르므로 행을 그대로 `ctx.files`에 넘길 수 있습니다.

- **sandboxed** — 컨텍스트 루트 기준 상대 경로이고 구분자는 `/`입니다(`notes/a.md`). 컨텍스트는
  `opts.context`로 지정합니다 — `PluginFileEvent`나 `vault:changed`가 준 `context`를 넘기십시오. 지정하지
  않으면 활성 컨텍스트가 답합니다. 절대 경로, `..`, `.baram`은 `ctx.files`처럼 거부됩니다.
- **trusted** — 절대 경로입니다. `opts.context`가 없으면 경로를 받는 읽기(`backlinks`, `links`, `file`을
  준 `tasks`, `folder`를 준 `search`)는 그 경로를 담는 가장 안쪽 볼트나 폴더가, 나머지는 활성 컨텍스트가
  답합니다.

모든 읽기는 등록된 볼트나 폴더 **하나**가 답합니다. 볼트 안에 폴더를 따로 등록했다면, 그 폴더에 물으면 그
폴더의 노트만 나오고, 바깥 노트까지 보려면 볼트에 물으십시오. 파일 하나짜리 컨텍스트는 인덱스가 없어
거부되고, 지정한 컨텍스트 밖의 경로도 거부됩니다.

## 돌려받는 것

```typescript
interface IndexBacklink { blockId: string | null; line: number; path: string; snippet: string; type: IndexLinkType }
interface IndexLink {
  blockId: string | null;
  line: number;
  path: string | null;   // resolution 이 "resolved" 일 때 — [[Paper.pdf]] 같은 첨부도
  resolution: "otherVault" | "resolved" | "unresolved";
  target: string;        // 괄호 안의 이름 — 별칭 · 제목 · 표시 글 없이
  type: IndexLinkType;   // "wikilink" | "blockRef" | "blockEmbed"
  vault: string | null;  // resolution 이 "otherVault" 일 때 — 링크가 부른 볼트 별칭
}
interface IndexTag { count: number; tag: string }   // count = 노트 수가 아니라 등장 횟수
interface IndexTask {
  path: string; line: number; state: "todo" | "doing" | "done" | "cancelled"; text: string;
  priority: number; tags: string[]; links: string[];
  created, start, scheduled, due, done, cancelled, recurrence: string | null;
}
interface IndexSearchResult { items: { line: number; path: string; snippet: string }[]; truncated: boolean }
```

- 줄 번호는 1부터 셉니다. 프론트매터까지 세므로 에디터가 보여 주는 줄과 같습니다.
- 값이 없는 필드는 `null`이고, 필드가 빠지는 일은 없습니다.
- `backlinks`는 (path, line) 순이고 한 줄에 한 행입니다. `links`는 줄 순, `tags`는 등장 횟수 순 다음 이름
  순, `notesWithTag`는 경로 순, `tasks`는 경로와 줄 순입니다.
- `snippet`은 링크가 있는 줄을 앞뒤 공백 없이, 200바이트에서 `…`로 잘라 담습니다 — 검색 일치라면 일치 앞뒤 100바이트까지이고 모두 합쳐 300자까지라서 긴 일치는 일치도 잘리며, 잘린 쪽에 `…`가 붙습니다.

## 읽기마다

- **`backlinks(path)`** — 그 노트를 가리키는 모든 링크입니다. 이름(`[[a]]`), 경로(`[[notes/a]]`), 볼트
  자신의 별칭 뒤의 링크, 블록 참조와 블록 임베드가 모두 해당합니다. 노트가 아직 없어도 물을 수 있고,
  폴더는 거부됩니다.
- **`links(path)`** — 노트가 있어야 하고, 노트(`.md`, `.markdown`)여야 하며, 볼트 걷기가 들어가는 곳이어야
  합니다 — 숨김 폴더나 `node_modules` 안은 거부됩니다.
- **`tags()`와 `notesWithTag(tag)`** — 태그는 소문자로 비교하고 앞의 `#`는 모두 떼므로 `#Work`로 `work`를
  찾습니다. 빈 태그는 거부됩니다.
- **`tasks(opts)`** — `status`의 기본값은 `"open"`(할 일과 진행 중)입니다. **설정 → 태스크 → 제외할
  폴더**에 적은 폴더는 여기서도 빠집니다. `file`을 주면 그 노트의 태스크만 나옵니다.
- **`search(query, opts)`** — 앱의 전역 검색처럼 컨텍스트의 `.md` 파일을 읽습니다(`.markdown` 노트는 검색하지
  않습니다). `limit`은 1부터 1000까지(기본 200)이고 줄이 아니라 일치의 수를 셉니다 — 한 줄에 일치가 둘이면
  행도 둘이고, `truncated`는 더 찾았다는 뜻입니다. `folder`는 검색을 그 폴더 안으로 옮기므로 `docs`가
  `docs-old`까지 검색하지 않습니다. `regex`는 정규식을 받고(잘못된 정규식은 이유와 함께 거부됩니다),
  `word`는 낱말 전체만 찾습니다.

## 다시 읽기

답은 디스크 기준이므로 아직 저장하지 않은 글은 들어 있지 않습니다. 열린 노트의 지금 글은
`ctx.editor.getMarkdown()`으로 읽으십시오. 물었던 컨텍스트에
[`"vault:changed"`](/ko/docs/plugin-dev/context-commands-editor-files-events/#contextevents-events-필요)가 오면
다시 읽으십시오 — 링크 인덱스가 변경을 반영한 뒤에 옵니다.

```typescript
let open: PluginFileEvent | undefined;
const refresh = async () => {
  if (!open) return;
  const links = await ctx.index.backlinks(open.path, { context: open.context });
  ctx.ui.setStatusBarText("links", `← ${links.length}`);
};
ctx.events.on("file:open", (file) => { open = file; void refresh(); });
ctx.events.on("vault:changed", ({ context }) => {
  if (open?.context === context) void refresh();
});
```

sandboxed 티어의 모양입니다. 저장소의 `examples/plugins/link-count`가 열린 태스크까지 함께 보여 주는 전체
예제입니다.

## 한계

- sandboxed 플러그인의 `tags`, `notesWithTag`, `tasks`, `search`는 볼트 전체를 읽으므로 예산을 함께 씁니다 —
  연달아 10번, 그 뒤로는 초당 1번 안팎입니다. 거부된 호출은 `rate limit exceeded`라고 합니다. `backlinks`와
  `links`는 링크 인덱스를 읽어 파일 작업의 더 큰 예산을 함께 씁니다. 컨텍스트의 첫 읽기(또는 빌드가 실패한
  뒤의 첫 읽기)는 그 인덱스를 만들며, 이때 볼트를 걷습니다. trusted 플러그인에는 이 예산이 없습니다.
- 이번 세션에 Baram이 열지 않은 볼트는 `vault:changed`를 보내지 않습니다. 그 볼트의 링크 인덱스는 첫 읽기에서
  만들어지고, Baram 밖에서 고친 뒤에는 낡을 수 있습니다.
- 이 읽기들이 돌려주는 오류에는 보낸 값(경로, 컨텍스트 id, 태그, 질의)만 실리고 볼트의 위치는 실리지 않습니다.
  걷기가 실패하면 `could not read the vault`, 링크 인덱스를 읽지 못하면
  `the link index for this context could not be read; try again in a moment`입니다.

## 버전 하한

`context.index`는 새 API입니다. `engines.baram`을 릴리스 노트에 이것이 처음 실린 버전으로
적으십시오 — [버전 하한](/ko/docs/plugin-dev/manifest/#버전-하한)을 보십시오.
