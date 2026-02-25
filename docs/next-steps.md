# Baram — Next Steps

Phase 2 (M7 연결 시스템 + M8 AI 심화)가 완료되었다. 이 문서는 남은 작업을 정리한다.

## 현재 상태

| Phase | 마일스톤 | 기능 수 | 상태 |
|-------|---------|---------|------|
| Phase 1 | M1-M6 | 47 | 완료 (v0.1.0) |
| Phase 2 | M7-M8 | 21 | 완료 (v0.2.0) |
| Phase 2 | M9 (인라인 마크+TOC+테이블 Tier 3+글로벌 검색+정의 목록) | 7 | ✅ 완료 (2026-02-25) |
| Phase 2 | M9 (나머지) | 7 | 미착수 |
| Phase 3 | M10 | 17 | 미착수 |

전체 98개 기능 중 75개 완료 (76.5%), 23개 남음 (23.5%).

---

## M9 — Productivity Tools (7개 남음)

| 우선순위 | 기능 | 설명 | 비고 |
|---------|------|------|------|
| 높음 | **§50 Mermaid Diagrams (고도화)** | 11종 다이어그램, 소스 편집 + 라이브 프리뷰 | M7에서 기본 구현 완료, 고도화 |
| ~~높음~~ | ~~**§51 Global Search (Cmd+Shift+F)**~~ | ~~tantivy 전문검색, regex, 파일/폴더 필터, Replace~~ | ✅ 완료 (2026-02-25) |
| 중간 | **§57b Git Basic** | status, commit, diff, branch switching, 사이드바 | Phase 3 Git Advanced 기반 |
| 중간 | **§54 Theme System** | CSS 커스텀 테마, 테마 갤러리 | 커뮤니티 확장 기반 |
| 중간 | **§52 Workspace Presets** | Writing/Skills/Research 프리셋 + 커스텀 | |
| 중간 | **§53 Notion Import/Export** | Notion API 연동, 양방향 변환 | |
| 중간 | **§55 Pandoc Extended Export** | .docx, LaTeX, Epub, Slide | M6 Export 확장 |
| 중간 | **§56 Journal/Daily Notes** | 자동 생성, 템플릿, 캘린더 | |
| 낮음 | **§57 @Mention System** | 날짜/페이지 멘션, 인라인 칩 | |

---

## 완료: 인라인 마크 + TOC + 테이블 Tier 3 + 글로벌 검색 + 정의 목록 (2026-02-25)

| 기능 | 문법 | 상태 |
|------|------|------|
| **Highlight** | `==text==` | ✅ 완료 — Mark Extension + SyntaxReveal + FloatingToolbar |
| **Subscript** | `~text~` | ✅ 완료 — Mark Extension + SyntaxReveal + FloatingToolbar |
| **Superscript** | `^text^` | ✅ 완료 — Mark Extension + SyntaxReveal + FloatingToolbar |
| **Table of Contents** | `[TOC]` / `/toc` | ✅ 완료 — ReactNodeView + 실시간 갱신 + 클릭 네비게이션 |
| **§5.5 Table Tier 3** | 열 리사이즈 + 파이프 입력 | ✅ 완료 — 열 너비 드래그 리사이즈(세션 전용), `\| H1 \| H2 \|`+Enter 자동 테이블 생성, Grid Picker 행 수 버그 수정 |
| **§5.11 Global Search** | `Cmd+Shift+F` | ✅ 완료 — tantivy 풀텍스트 검색, regex, 파일/폴더 필터, Replace |
| **Definition List** | `Term\n: Definition` | ✅ 완료 — 3 Node Extensions (dl/dt/dd), InputRule `: `, Backspace/Enter/Shift-Enter 키보드 |

---

## Phase 3: M10 — Advanced Features (15개 기능)

### Knowledge Management (4개)

| 기능 | 설명 |
|------|------|
| **§58 Graph View (Enhanced)** | 인터랙티브 지식 그래프, 필터, 클러스터링, 검색 |
| **§59 Query Blocks** | 비주얼 쿼리 빌더, 동적 콘텐츠 필터링 |
| **§60 Canvas** | 무한 캔버스, 자유 배치 (Obsidian Canvas 유사) |
| **§61 Namespaces** | 계층적 파일 그루핑, 네임스페이스 기반 조직 |

### AI Level 4 + 5 (5개)

| 기능 | 설명 |
|------|------|
| **§62 Agent Mode** | 멀티파일 자율 편집: 목표 → 계획 → 실행 → 통합 diff 리뷰 |
| **§63 Knowledge Q&A** | 볼트 전체 벡터 검색, RAG 파이프라인, 인용 기반 답변 |
| **§64 LLM Interpretation Simulation** | 동일 프롬프트 멀티 모델 비교, A/B 테스트 |
| **§65 MCP Server Integration** | Model Context Protocol 외부 서비스 통합 |
| **§66 Custom AI Plugin API** | 커뮤니티 AI 확장을 위한 공개 API |

### Collaboration & Infrastructure (5개)

| 기능 | 설명 |
|------|------|
| **§67 Git Advanced** | 원격 동기화, PR/MR 생성, 충돌 해결 UI, 히스토리 브라우저 |
| **§68 Real-time Collaboration** | Yjs CRDT 기반, 라이브 커서, 프레즌스 |
| **§69 Plugin Marketplace** | 커뮤니티 플러그인, Extension API 공개 |
| **§70 Mobile Support** | Tauri Mobile (iOS/Android) |
| **§71 File Snapshots / Version History** | 타임머신 스타일 파일 버저닝 |

### Table Advanced (2개)

| 기능 | 설명 |
|------|------|
| **§5.5a Cell Merge** | 셀 병합 (에디터 전용, GFM 미지원 — 마크다운 직렬화 시 개별 셀로 분리) |
| **§5.5b Virtual Scroll (50+ rows)** | 50행 이상 대형 테이블 가상 스크롤로 DOM 노드 수 제한 |

### LLM Skills Specialized (1개)

| 기능 | 설명 |
|------|------|
| **§72 Skills-Dedicated Mode** | LLM Skills 편집에 최적화된 전용 UI 모드 |

---

## 품질 / 기술 부채

| 항목 | 상태 |
|------|------|
| CommonMark 공식 테스트 651개 | 0/651 (미통합) |
| GFM 공식 테스트 120개 | 0/120 (미통합) |
| 수동 성능 측정 5개 (앱 시작, 타이핑 레이턴시, 유휴 메모리 등) | Tauri 릴리즈 빌드 후 측정 필요 |

---

## 추천 착수 순서

1. ~~**Global Search (§51)**~~ — ✅ 완료
2. **Git Basic (§57b)** — Phase 3 Git Advanced의 기반
4. **Theme System (§54)** — 사용자 커스터마이징
5. **나머지 M9 기능들**

Phase 3는 M9 완료 후 착수한다. 최우선: Agent Mode (§62), Knowledge Q&A (§63).
