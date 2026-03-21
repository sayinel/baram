# Cross-vault 링크 설계 결정

> 논의 날짜: 2026-03-21

---

## 결정: Option C — 명시적 절대경로 링크

**기본 격리, 명시적 절대경로 링크만 허용.**
완전 격리도, 완전 통합도 아닌 세 번째 방식.

---

## 옵션 비교

### Option A: 완전 격리

```
[[analyzer]] → 현재 vault 내에서만 해석
               다른 vault의 analyzer.md는 보이지 않음
```

- 구현 단순, 이식성 완벽, Obsidian 멘탈 모델과 동일
- **탈락 이유:** Persona 1(LLM 개발자)의 multi-vault 시나리오 차단.
  work-vault의 skill이 journal-vault의 메모를 참조하는 것이 불가능

### Option B: 완전 통합

```
[[analyzer]] → 열린 모든 vault에서 analyzer.md를 검색
               여러 개 발견 시 선택 팝업
```

- **탈락 이유 (치명적):**
  - **모호성:** `[[parser]]` 가 work-vault와 journal-vault에 모두 있으면 어느 것을 가리키는가? 비결정적 링크
  - **이식성 파괴:** vault-A를 다른 컴퓨터로 옮기면 vault-B가 없는 환경에서 모든 cross-vault 링크가 dangling. "vault는 자기완결적이어야 한다" 위반
  - **인덱스 복잡도:** 백링크 조회 시 모든 열린 vault의 DB를 federation 쿼리해야 함

### Option C: 명시적 절대경로 (채택)

```
vault 내부 (기존과 동일):
  [[analyzer]]              → 현재 vault 내에서만 해석

cross-vault (명시적):
  [[work::analyzer]]        → work alias vault의 analyzer.md
  [[work::skills/analyzer]] → 경로 지정
  [[journal::2026-03-21]]   → journal vault의 특정 파일
```

alias는 `~/.config/baram/app-workspace.json` 에 등록.

---

## 링크 해석 우선순위

```
[[파일명]] 해석:
  1순위: 현재 vault 내 exact match
  2순위: 현재 vault 내 fuzzy match
  3순위: ❌ 다른 vault 검색 안 함 (격리 기본값)

[[alias::파일명]] 해석:
  1순위: alias vault에서 exact match
  2순위: alias vault에서 fuzzy match
  미열림: → dangling 표시 + "열기" 제안
```

---

## 자동완성 UX

```
[[ 입력 후:
  ┌────────────────────────────────────┐
  │  📁 현재 vault (work)               │
  │     analyzer.md                    │
  │     parser.md                      │
  │  ─────────────────────────────     │
  │  💡 cross-vault: "journal::" 입력  │
  └────────────────────────────────────┘

[[journal:: 입력 후:
  ┌────────────────────────────────────┐
  │  📔 journal vault                  │
  │     2026-03-21.md                  │
  │     2026-03-20.md                  │
  └────────────────────────────────────┘
```

---

## Dangling 링크 처리

```
[[journal::2026-03-21]]  (journal vault 미열림)

  렌더링:  🔗 journal::2026-03-21  (회색)
  호버:    "journal vault가 열려 있지 않습니다."  [열기]
  저장:    [[journal::2026-03-21]] 그대로 보존 (roundtrip fidelity 유지)
```

---

## 이식성 보장

vault를 다른 컴퓨터로 이동할 때를 대비해 `.baram/config.json` 에 alias 힌트 저장.

```jsonc
// work-vault/.baram/config.json
{
  "crossVaultHints": {
    "journal": {
      "lastKnownPath": "/Users/동훈/journal"
    }
  }
}
```

새 환경에서 vault를 열면 `lastKnownPath` 기반으로 alias 자동 매칭을 시도하고,
실패 시 사용자에게 경로 재지정을 안내한다.

---

## SQLite 스키마 변경 (최소)

기존 `links` 테이블에 컬럼 하나만 추가.

```sql
ALTER TABLE links ADD COLUMN target_vault_alias TEXT DEFAULT NULL;
-- NULL:       현재 vault 내 링크 (기존 동작 유지)
-- 'journal':  cross-vault 링크
```

---

## Graph View에서의 Cross-vault 동작

### Scope 선택 UI

Graph View 상단에서 사용자가 scope를 명시적으로 선택한다.

```
  ● 현재 vault (work)     ← 기본값, 기존과 동일
  ○ 열린 vault 전체
  ○ 로컬 (현재 파일 n-depth)
```

기본값은 항상 현재 vault 하나. "열린 vault 전체"를 선택할 때만 multi-vault 그래프를 구성한다.

### Multi-vault 그래프 구성

각 vault의 `link-index.db`를 개별 조회 후 단순 merge한다. DB federation이 아니다.

```rust
fn build_multi_vault_graph(contexts: &[VaultContext]) -> GraphData {
    let mut nodes = vec![];
    let mut edges = vec![];

    for ctx in contexts {
        // vault prefix로 노드 ID 충돌 방지
        // 예: "work::skills/parser.md", "journal::2026-03-21.md"
        nodes.extend(ctx.link_index.query_all_files()
                        .map(|n| n.with_vault_prefix(&ctx.alias)));
        edges.extend(ctx.link_index.query_all_links()
                        .map(|e| e.with_vault_prefix(&ctx.alias)));

        // cross-vault 링크 추가 (target_vault_alias IS NOT NULL인 rows)
        edges.extend(ctx.link_index.query_cross_vault_links());
    }

    GraphData { nodes, edges }
}
```

D3.js 렌더링 코드는 변경 없음. 노드 색상만 컨텍스트의 `color` 필드로 지정한다.

### 시각적 구분

```
  🔵 work vault 노드       🟢 journal vault 노드
     ◉ parser.md                ◉ 2026-03-21
     |                              |
     ◉ analyzer.md ╌╌╌╌╌╌╌╌╌╌╌ ◉ 2026-03-20
     |
     ◉ skill-x.md

  ── 실선: 같은 vault 내 링크
  ╌╌ 점선: cross-vault 링크 ([[alias::파일명]])
```

점선으로 cross-vault 엣지를 구분하면 어떤 연결이 vault 경계를 넘는지 한눈에 파악된다.

---

## Knowledge Q\&A에서의 Cross-vault 동작

### Scope 선택

Chat Panel의 `@` 참조로 검색 대상 vault를 명시적으로 지정한다.

```
기존 @ 참조 (현재 vault 내):
  @파일명      → 현재 vault의 특정 파일
  @folder      → 현재 vault의 특정 폴더

추가 (cross-vault):
  @work        → work vault 전체를 컨텍스트로
  @journal     → journal vault 전체를 컨텍스트로
  @all-vaults  → 열린 모든 vault

예시:
  "@work의 parser 스킬과 @journal의 오늘 메모의 연관성은?"
  → work vault + journal vault 동시 검색
```

### Multi-vault 벡터 검색 파이프라인

```
사용자 질문 + scope (@work, @journal)
     │
     ▼
질문 임베딩 생성 (1회)
     │
     ├──→ work/.baram/embeddings/index.usearch 에서 Top-K 검색
     └──→ journal/.baram/embeddings/index.usearch 에서 Top-K 검색
     │         (futures::join_all 로 병렬 실행)
     ▼
결과 merge + 코사인 유사도 기준 재정렬 → 상위 10개
     │
     ▼
컨텍스트 조립 + LLM 호출 (기존과 동일)
     │
     ▼
Citation에 vault 출처 표시
  [1] work::skills/parser.md#파싱-전략     ← 클릭 시 해당 파일로 이동
  [2] journal::2026-03-21.md#오늘의-메모
```

```rust
async fn knowledge_qa(
    question: &str,
    scope: &[&VaultContext],
) -> Vec<RankedChunk> {
    let question_vec = embed(question).await;

    let results = futures::join_all(
        scope.iter().map(|ctx| async {
            ctx.embedding_index
               .search(&question_vec, TOP_K)
               .map(|chunk| chunk.with_vault_prefix(&ctx.alias))
        })
    ).await;

    results.into_iter()
           .flatten()
           .sorted_by(|a, b| b.score.partial_cmp(&a.score))
           .take(10)
           .collect()
}
```

usearch는 in-memory 인덱스이므로 여러 개를 동시에 열어두는 것이 자연스럽다.
tantivy 전문 검색은 `MultiReader`로 여러 인덱스를 단일 쿼리로 처리할 수 있어
추가 구현 부담이 없다.

### 복잡도가 낮은 이유

scope를 앱이 자동으로 결정하지 않고 **사용자가 명시적으로 지정할 때만** N개 DB를
쿼리하기 때문이다. 기본값은 항상 현재 vault 1개 = 기존 동작과 동일하다.

| 기능                | 추가 복잡도 | 근거                            |
| ----------------- | ------ | ----------------------------- |
| Graph 노드 ID 충돌 방지 | 낮음     | vault prefix 추가만으로 해결         |
| Graph 엣지 merge    | 낮음     | for 루프로 각 DB 조회 후 합산          |
| 벡터 검색 병렬화         | 낮음     | `futures::join_all` 한 줄       |
| 전문 검색 multi-vault | 없음     | tantivy `MultiReader` 네이티브 지원 |
| Citation 포맷 변경    | 없음     | `파일명` → `vault::파일명` 포맷만 변경   |

---

## 옵션 비교 요약

| 기준                 | 완전 격리 | 완전 통합 | **Option C**    |
| ------------------ | ----- | ----- | --------------- |
| 구현 복잡도             | 낮음    | 높음    | **중간**          |
| 링크 결정성             | 완벽    | 모호    | **완벽**          |
| 이식성                | 완벽    | 파괴    | **보장**          |
| Persona 1 사용성      | 나쁨    | 좋음    | **좋음**          |
| Roundtrip fidelity | 완벽    | 복잡    | **완벽**          |
| 점진적 도입             | —     | —     | **M3 이후 연기 가능** |

---

## 구현 시점

```
M1: 완전 격리로 시작 (단일 vault만)
M2: multi-context UI 구현
M3: [[alias::파일명]] cross-vault 링크 추가
    (사용자가 실제로 요청할 때 구현해도 늦지 않음)
```

cross-vault 링크는 **의도적으로 써야 하는 기능**이다.
`[[journal::오늘]]` 을 직접 타이핑하는 사람은 vault 경계를 이해하고 사용하는 것이므로,
명시적 문법이 암묵적 자동 해석보다 더 적합하다.
