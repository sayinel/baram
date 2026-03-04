# Graph View 개선 계획

## 분석 결과: Graph View가 제대로 안 그려지는 이유

### 근본 원인 1: Wikilink 타겟 경로 해석 실패

`src-tauri/src/index/mod.rs`의 `resolve_target()`이 항상 `{root}/{target}.md`로만 해석한다.
하위 폴더를 검색하지 않기 때문에:

- Daily에서 `[[my-note]]` → `{root}/my-note.md`로 해석 (실제 파일은 `notes/my-note.md`)
- 해당 파일을 못 찾으니 **ghost node** 생성 → 실제 파일 노드와 별도로 존재
- 결과: daily → note, note → sub-note 연결이 각각 **별개의 독립 그래프**로 분리됨

이것이 "각각 독립적인 연결 그래프가 만들어지는" 핵심 원인.

### 근본 원인 2: 태그가 그래프에 완전히 빠져있음

`LinkIndex`는 `[[wikilink]]`, `((block-ref))`, `{{embed}}`만 추출한다.
`#tag`는 아예 추출하지 않아서 태그 기반 연결이 그래프에 전혀 표현되지 않음.

### 근본 원인 3: Daily 파일의 구조적 고립

Daily 파일들은 서로 링크하지 않는 것이 일반적이라,
위 두 문제가 해결되지 않으면 대부분 orphan node로 남음.

---

## 개선 제안

### 1. Wikilink 경로 해석 수정 (가장 중요, 영향 큼)

**현재:**
```rust
fn resolve_target(root: &str, target: &str) -> String {
    format!("{}/{}.md", root, target)  // 하위 폴더 무시
}
```

**개선:** `LinkIndex`에 `file_map: HashMap<String, String>` (filename → full_path) 추가

```rust
// index build 시 모든 .md 파일의 stem → path 매핑 구축
file_map: HashMap<String, String>  // "my-note" → "/vault/notes/my-note.md"

fn resolve_target(&self, target: &str) -> Option<String> {
    // 1) 경로 포함 시 직접 해석: [[notes/arch]] → {root}/notes/arch.md
    // 2) 파일명만 있으면 file_map에서 탐색: [[my-note]] → file_map["my-note"]
    // 3) 동명 파일 여러 개면 가장 가까운 경로 우선
}
```

이것만 수정해도 daily → note → sub-note 체인이 하나의 연결 그래프로 합쳐짐.

### 2. 태그 기반 연결 추가

**옵션 A — 태그를 가상 노드로 표시 (Obsidian 방식, 추천)**
- `#project-x` 태그가 3개 파일에 있으면 → `#project-x` 가상 노드 1개 + 3개 파일로의 edge 3개
- 태그 노드는 별도 스타일 (예: 다이아몬드/다른 색상)로 구분

**옵션 B — 같은 태그를 공유하는 파일끼리 직접 연결**
- 태그가 많은 파일에서 edge 폭발 (n개 파일 → n*(n-1)/2 edges)

### 3. Daily 파일 전용 개선

| 개선 | 설명 |
|------|------|
| **Orphan 기본 숨김** | Journal scope에서 연결 없는 daily는 기본 숨김 (토글 가능) |
| **날짜 클러스터링** | 같은 월/주의 daily를 compound node로 그룹핑 |
| **temporal edge** | 연속된 날짜를 얇은 점선으로 연결 (토글) |

### 4. UI 개선

| 개선 | 설명 |
|------|------|
| **노드 타입별 시각 구분** | Daily(원), Note(둥근사각), Tag(다이아몬드), Ghost(점선 원) |
| **폴더별 색상** | 최상위 폴더별 자동 색상 할당 |
| **필터 패널** | 노드 타입별 on/off, 특정 폴더/태그만 표시 |

---

## 우선순위

| 순위 | 작업 | 영향도 | 난이도 | 상태 |
|------|------|--------|--------|------|
| **1** | Wikilink 경로 해석 수정 | ★★★★★ | 중 | 진행 중 |
| **2** | 태그 가상 노드 추가 | ★★★★ | 중 | 대기 |
| **3** | 노드 타입별 시각 구분 | ★★★ | 하 | 대기 |
| **4** | Orphan daily 기본 숨김 | ★★★ | 하 | 대기 |
| **5** | 폴더별 색상 | ★★ | 하 | 대기 |
| **6** | 날짜 클러스터링/temporal edge | ★★ | 중 | 대기 |
