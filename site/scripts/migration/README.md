# 문서 분할 이주 도구 (2026-09-07, 일회성)

`docs/*.md` 4개를 57페이지로 쪼개 `site/src/content/docs/en/docs/**` 로 옮긴 도구다.
**이주는 끝났고 이 스크립트들은 다시 돌리지 않는다.** 지우지 않고 남긴 이유는 하나다 —
"분할에 손실이 없었다" 는 주장을 **누구든 재현해 확인할 수 있어야** 하기 때문이다.

설계: `dev/design/specs/0044-docs-site-i18n-restructure-design.md`
페이지 트리: `dev/design/specs/0045-docs-site-ia-tree.md`

## 무엇을 증명했나

```
✅ docs/user-guide.md         — 1965줄 바이트 동일
✅ docs/plugin-development.md — 1115줄 바이트 동일
✅ docs/faq.md                —  888줄 바이트 동일
✅ docs/keyboard-shortcuts.md —  367줄 바이트 동일
```

생성된 57페이지에서 원문을 **다시 조립**해 바이트 동일성을 단정했다. 내부 링크 목적지 61개만
비교에서 제외했고(분할하면 앵커가 페이지 간 링크로 승격되어 의도적으로 바뀐다), 그 정합성은
빌드의 `starlight-links-validator` 가 전수 검증한다 — "All internal links are valid".

## 재현하는 법

원문은 이주 커밋에서 삭제됐다. 그 직전 상태로 복원해야 돌아간다.

```bash
# 이 디렉터리가 처음 들어온 커밋의 부모에서 원문을 꺼낸다
git log --diff-filter=A --format=%H -1 -- site/scripts/migration   # → <c>
git checkout <c>~1 -- docs/

cd site
node scripts/migration/check-ia.mjs         # 배정 소진 (단위 + 머리말 = 파일 전체)
node scripts/migration/split-docs.mjs       # 57페이지 재생성
node scripts/migration/check-roundtrip.mjs  # 역조립 바이트 동일성
git diff --stat src/content/docs/en/docs    # 비어야 한다 = 결과가 재현된다

git checkout HEAD -- ../docs                # 원문 되돌리기
```

## 이 게이트들이 증명하지 못하는 것

**"버림 선언이 옳은가" 는 판정할 수 없다.** 매니페스트가 "버린다" 고 하면 기대·실제 양쪽이
함께 생략해 일치하므로, 배정을 버림으로 바꾸는 뮤테이션은 `check-roundtrip` 도
`check-ia` 도 통과한다(실측 확인). 그래서 `check-roundtrip` 이 버려지는 줄을 **전부 출력**한다.
실제로 버린 것은 손으로 관리하던 `## Table of Contents` 25줄과 두 문서의 H1·구분선뿐이다.

## 개발 중 이 게이트들이 잡은 결함

| 결함 | 무엇이 잡았나 |
| --- | --- |
| 파일 머리말 20줄이 아무 페이지에도 배정되지 않았다 | **파일 소진 산술**. 개수 기반 단위 대조는 초록이었다 — 단위 위에서만 합을 셌기 때문이다 |
| 흡수한 heading 의 백틱이 사라졌다 (`## Manifest (\`…\`)`) | 역조립 바이트 비교. `parseHeadings` 가 백틱을 지운 값을 쓰고 있었다 → `raw` 필드 추가 |
| 문서 통째 페이지의 비교가 공허했다 | 기대·실제 양쪽에 원문을 넣고 있었다. 페이지에서 읽도록 고친 뒤 한 글자 변경이 잡히는 것을 확인 |
| 앵커 승격으로 내부 링크가 전부 깨졌다 | `starlight-links-validator` 가 `invalid hash` 로 잡았다 |

## 살아 있는 게이트

이주 후에는 원문이 없으므로 배정 대조가 불가능하고, 페이지는 번역이 편집하는 표면이 된다.
그 뒤를 지키는 것은 `../check-pages.mjs` 다 — 매니페스트↔디스크 양방향 · 제목 · 크기 ·
로케일 대칭 · 그룹 정합.
