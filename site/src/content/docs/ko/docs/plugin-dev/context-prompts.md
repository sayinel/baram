---
title: "컨텍스트: 선택창과 입력창"
sourceHash: "20d862f8e89c"
---

## `context.prompts`

Baram 이 그리고 답을 플러그인에 돌려주는 선택창(걸러 고르는 목록)과 입력창입니다. 두 티어가 같은
두 메서드를 받고 권한은 필요 없습니다 — 막는 것은 **언제** 열 수 있느냐입니다.

```typescript
showQuickPick(items: QuickPickItem[], opts?: QuickPickOptions): Promise<string | undefined>;
showInputBox(opts?: InputBoxOptions): Promise<string | undefined>;

// QuickPickItem    = { id: string; label: string; description?: string }
// QuickPickOptions = { title?: string; placeholder?: string }
// InputBoxOptions  = { title?: string; placeholder?: string; value?: string }
```

`showQuickPick` 은 고른 항목의 `id` 를, `showInputBox` 는 입력한 글을 돌려줍니다(빈 문자열도
답입니다). 입력하는 동안 Baram 이 거릅니다 — `label` 을 먼저, 그다음 `description` 을 보고 가장 잘
맞는 50개를 보여 줍니다. 아무것도 입력하지 않았으면 넘긴 순서의 처음 50개입니다.

```typescript
ctx.commands.register("insert-template", async () => {
  const id = await ctx.prompts.showQuickPick(
    templates.map((t) => ({ id: t.file, label: t.name, description: t.folder })),
    { title: "Insert template" },
  );
  if (id === undefined) return; // 취소
  const title = await ctx.prompts.showInputBox({ placeholder: "Note title" });
  if (title === undefined) return;
  // …
});
```

## 창을 열 수 있는 때

창은 **사용자가 시작한 이 플러그인의 커맨드가 아직 도는 동안**(명령 팔레트나 이 플러그인의 상태
표시줄 항목에서), 그리고 사용자가 **창 밖에서 키를 누르거나 클릭하기 전까지만** 열립니다.

- 커맨드 핸들러가 돌려준 promise 가 끝나기 전에 요청하십시오. 끝난 뒤에는 — 이 플러그인의 다른
  커맨드가 돌고 있지 않다면 — 거부됩니다.
- 권리는 호출이 아니라 플러그인의 것입니다. 커맨드가 도는 동안에는 이 플러그인의 이벤트 핸들러와
  타이머도 창을 열 수 있습니다.
- 창 밖의 첫 키 · 클릭 · 글 입력(받아쓰기 포함) · 끌어다 놓기가 권리를 끝냅니다. 여러 단계 흐름에서
  한 창이 닫히고 다음 창이 열리기 전에 친 키도 포커스가 있는 곳으로 가고 권리를 끝냅니다. 수정자 키
  하나만 누른 것은 세지 않습니다.
- 취소도 권리를 끝냅니다. 사용자가 커맨드를 다시 실행할 때까지 이후 요청은 거부됩니다. 고르거나
  입력을 마친 것은 끝내지 않습니다 — "템플릿 고르기 → 제목 입력" 이 됩니다.
- sandboxed 커맨드는 시작부터 첫 창까지, 그리고 창이 닫힐 때마다 다음 창까지 각각 30초가
  있습니다. 창에 머문 시간은 세지 않습니다.
- trusted 플러그인 자신의 패널 · 설정 탭 · 파일 뷰어 안의 클릭은 커맨드가 아니므로 거기서 연 창은
  거부됩니다.
- 다른 창이 — 이 플러그인의 것이든 다른 플러그인의 것이든 — 열려 있을 때, 포커스가 프레임(HTML 미리보기 등) 안에 있을 때, 창이 뜰
  자리를 다른 창이 덮고 있을 때도 거부됩니다 — 마지막 경우는 취소처럼 권리를 끝냅니다.

## 취소와 거부

| 결과                  | 뜻                                                                        |
| --------------------- | ------------------------------------------------------------------------- |
| `undefined` 로 끝남   | 사용자가 취소했습니다: Esc, 바깥 클릭, 명령 팔레트나 빠른 전환이 열림   |
| reject                | 호출이 거부됐습니다 — 이유는 메시지에 있습니다                            |

플러그인을 끄거나 지우거나 다시 불러오는 동안에는 열린 창이 닫히고, 호출은 `undefined` 로 끝나거나
reject 될 수 있습니다. 어느 쪽에도 기대지 마십시오.

## 상한

| 대상                   | 상한      | 넘으면                                     |
| ---------------------- | --------- | ------------------------------------------ |
| 선택창 하나의 항목 수  | 1–5,000   | 0 또는 5,000 초과면 reject                 |
| 항목 `id`              | 100자     | reject — id 는 비교하는 값이라 자르지 않음 |
| 중복 `id`              | —         | reject                                     |
| `label` · `description` | 200자    | "…" 로 자름                                |
| `title` · `placeholder` | 100자    | "…" 로 자름                                |
| 문자열 하나            | 4,096자   | reject                                     |
| 입력창 초기 `value`    | 1,000자   | reject                                     |
| 입력한 글              | 1,000자   | 더 입력되지 않음                           |

보이는 글에서는 제어 문자와 bidi · zero-width 서식 문자를 지웁니다. 초기 `value` 는 공백을 자르지
않지만, 텍스트 입력 칸이 그 안의 줄바꿈을 지웁니다. sandboxed 티어에서는 문자열에 짝 없는
서로게이트(이모지의 반쪽 — 예를 들어 이모지 중간을 `slice` 한 결과)가 있거나 보낼 때 8 MiB 를
넘어도 거부됩니다.

창 머리에는 플러그인 이름 앞에 고정된 "플러그인" 배지가 붙어, 사용자가 앱의 질문과 구별할 수
있습니다.

## 버전 하한

`context.prompts` 는 새 API 입니다. `engines.baram` 을 릴리스 노트에 이것이 처음 실린 버전으로
적으십시오 — [버전 하한](/ko/docs/plugin-dev/manifest/#버전-하한)을 보십시오.
