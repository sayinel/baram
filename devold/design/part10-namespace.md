# §61 네임스페이스 설계서

> Phase 3 — 지식 관리
> 상태: P0 설계 승인 (2026-03-07)

---

## 1. 개요

폴더 구조를 네임스페이스로 활용한다. `[[./file]]` 상대 링크로 같은 네임스페이스(폴더) 내 파일을 참조한다. 기존 `[[file]]`(전역)과 `[[path/file]]`(절대) 동작은 100% 유지.

### 핵심 원칙

- **폴더 = 네임스페이스**: 별도 설정 없이 폴더 구조가 자동으로 네임스페이스
- **명시적 구분**: `./` prefix로 상대 참조를 명시 (기존 링크에 영향 없음)
- **하위 호환성 100%**: 기존 wikilink 동작 변경 없음

---

## 2. Wikilink 해석 규칙

| 입력 | 의미 | 해석 |
|------|------|------|
| `[[prompt]]` | 전역 검색 | 기존 동작 유지 — vault 전체에서 파일명 매칭 |
| `[[./prompt]]` | 같은 네임스페이스 | 현재 파일의 폴더 기준 상대 경로 |
| `[[./sub/prompt]]` | 하위 네임스페이스 | 현재 폴더의 하위 경로 |
| `[[../other/prompt]]` | 상대 경로 탐색 | `../`로 부모 디렉토리 기준 |
| `[[notes/ai/prompt]]` | 절대 경로 | vault root 기준 (기존 동작) |

### 해석 알고리즘

```
resolve(target, source_path, vault_root):
  if target starts with "./" or "../":
    # 상대 경로 — source 파일의 디렉토리 기준
    source_dir = dirname(source_path)
    candidate = normalize(join(source_dir, target))
    if exists(candidate + ".md"):
      return candidate + ".md"
    return null  # 상대 경로는 fallback 없음

  if target contains "/":
    # 절대 경로 — vault root 기준 (기존 동작)
    return resolve_from_relative_map(target)

  # 전역 검색 — 파일명 매칭 (기존 동작)
  return resolve_from_file_map(target)
```

---

## 3. 자동완성 규칙

| 입력 | 제안 범위 |
|------|----------|
| `[[` | vault 전체 파일 (기존 동작) |
| `[[./` | 현재 파일과 같은 디렉토리의 파일만 |
| `[[./sub/` | 현재 디렉토리의 `sub/` 하위 파일만 |
| `[[../` | 부모 디렉토리의 파일만 |

자동완성 선택 시 삽입 형식: `[[./filename]]` (`.md` 확장자 제외)

---

## 4. Quick Switcher 네임스페이스 표시

파일 검색 결과에 네임스페이스 경로를 `detail` 필드로 표시한다.

```
  prompt.md                    notes/ai
  architecture.md              dev/design
  config.md                    (root)
```

- vault root 파일은 detail 비워둠
- 네임스페이스는 vault root 기준 상대 디렉토리 경로

---

## 5. Roundtrip 보존

`[[./prompt]]` 마크다운은 ProseMirror wikilink node의 `target` attr에 `"./prompt"`로 저장된다.

- `./` prefix는 target 문자열에 그대로 포함
- 별도 attr 불필요 — target이 `./`로 시작하면 상대 링크
- `[[./prompt]]` → PM node → `[[./prompt]]` (정확한 roundtrip)

---

## 6. 변경 범위

### Rust 백엔드

| 파일 | 변경 |
|------|------|
| `src-tauri/src/index/mod.rs` | `resolve_target_from_map()`에 source_path 파라미터 추가, `./` `../` 상대 경로 해석 |
| `src-tauri/src/commands/index_cmd.rs` | 관련 IPC에 source_path 전달 |

### TypeScript 프론트엔드

| 파일 | 변경 |
|------|------|
| `src/extensions/nodes/wikilink.ts` | regex에 `./` `../` prefix 허용 |
| `src/pipeline/transformers/wikilink-transformer.ts` | `./` prefix roundtrip 보존 |
| `src/extensions/plugins/wikilink-suggest.ts` | `[[./` 입력 시 같은 디렉토리 파일 필터 |
| `src/utils/wikilink-nav.ts` | 상대 경로 resolve 로직 추가 |
| `src/components/command/QuickSwitcher.tsx` | 네임스페이스 detail 표시 |

### 테스트

- wikilink roundtrip: `[[./file]]`, `[[../other/file]]` 보존 테스트
- Rust: 상대 경로 resolve 단위 테스트
- wikilink-suggest: `[[./` 필터링 테스트
- QuickSwitcher: 네임스페이스 detail 표시 테스트

---

## 7. 후속 (P1/P2 — 별도 구현)

- Graph View 네임스페이스 색상/필터
- Backlinks 네임스페이스 그룹핑
- 자동 네임스페이스 prefix 삽입
- `ns:` Quick Switcher 필터
- 네임스페이스 이름 변경 (폴더 rename + wikilink 일괄 갱신)
