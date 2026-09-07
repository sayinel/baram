---
title: "콜아웃과 토글"
sourceHash: "ad8e9f33aec3"
---


## 콜아웃 블록

콜아웃 블록은 Obsidian 문법과 호환되는 강조 안내문입니다.

```markdown
> [!info] 제목
> 내용이 여기 들어갑니다.
```

**지원하는 종류:** `info`, `tip`, `warning`, `danger`, `note`, `abstract`, `todo`, `success`, `question`, `failure`, `example`, `quote`

종류마다 색과 아이콘이 다릅니다. 종류 뒤에 `-`를 붙이면 접을 수 있게 됩니다.

```markdown
> [!warning]- 클릭해서 펼치기
> 이 내용은 기본적으로 숨어 있습니다.
```

콜아웃은 슬래시 명령 `/callout`으로, 또는 줄 맨 앞에서 `> [!`를 입력해 만듭니다.

## 토글 블록

토글 블록은 HTML `<details>` 문법으로 접히는 구역을 만듭니다.

```markdown
<details>
<summary>클릭해서 펼치기</summary>

숨은 내용이 여기 들어갑니다. 문단·목록·코드 블록 등 어떤 블록이든 담을 수 있습니다.

</details>
```

**기능:**

- **접기/펼치기** — 삼각형 표시를 클릭하거나 `Cmd+Enter`를 누릅니다
- **토글 제목** — 제목을 요약으로 써서 접히는 제목 구역을 만듭니다:
  ```markdown
  <details>
  <summary>## 구역 제목</summary>

  접을 수 있는 구역 내용.

  </details>
  ```
- **중첩 토글** — 토글 안에 토글을 넣어 계층을 만듭니다
- 슬래시 명령으로 만들기: `/toggle`, `/toggle heading 1`, `/toggle heading 2`, `/toggle heading 3`
