# Baram — Next Steps

Phase 1\~2 완료, Phase 3 진행 중. 이 문서는 남은 작업을 정리한다.

## 현재 상태

| Phase    | 마일스톤                                   | 기능 수 | 상태                                     |
| -------- | -------------------------------------- | ---- | -------------------------------------- |
| Phase 1  | M1-M6                                  | 47   | ✅ 완료 (v0.1.0)                          |
| Phase 2  | M7-M8                                  | 21   | ✅ 완료 (v0.2.0)                          |
| Phase 2  | M9                                     | 14   | ✅ 완료                                   |
| Phase 3  | Table Advanced (셀 병합 + 가상 스크롤)         | 2    | ✅ 완료                                   |
| Phase 3  | Query Block (§5.13)                    | 1    | ✅ 완료                                   |
| Phase 3  | Git Advanced (§67)                     | 1    | ✅ 완료                                   |
| Phase 3  | File Snapshots / Version History (§71) | 1    | ✅ 완료                                   |
| Phase 3  | i18n (EN/KR) + 키바인딩 커스터마이징             | 2    | ✅ 완료                                   |
| Phase 3  | 나머지 (Canvas, Agent Mode 등)             | 10   | 미착수                                    |
| **리팩토링** | Phase A\~D + 보안 감사                     | —    | ✅ 완료 (`refactoring/code-reuse`, PR 대기) |

전체 \~98개 기능 중 88개 완료 (89.8%), 10개 남음 (10.2%).

> **리팩토링 브랜치 상태**: `refactoring/code-reuse` → `main` PR 머지 대기 중
> 코드리뷰 APPROVE (2018 테스트 통과, TypeScript 0 에러, CRITICAL/HIGH 이슈 0건)

---

## M9 — Productivity Tools (✅ 완료)

모든 M9 기능 완료: Mermaid 고도화, Global Search, Git Basic, Theme System, Workspace Presets, Export for Notion, Pandoc Export, Journal/Daily Notes, @Mention System, Inline Marks, TOC, Table Tier 3, Definition List, Footnotes, Help Panel, Extension Settings.

---

---

## Phase 3 — 남은 기능 (10개)

### Knowledge Management

| 기능                       | 설명                                 | 상태   |
| ------------------------ | ---------------------------------- | ---- |
| ~~**§59 Query Blocks**~~ | ~~비주얼 쿼리 빌더, 동적 콘텐츠 필터링~~          | ✅ 완료 |
| **§60 Canvas**           | 무한 캔버스, 자유 배치 (Obsidian Canvas 유사) | 미착수  |
| **§61 Namespaces**       | 계층적 파일 그루핑, 네임스페이스 기반 조직           | 미착수  |

### AI Level 4 + 5

| 기능                                    | 설명                                    | 상태  |
| ------------------------------------- | ------------------------------------- | --- |
| **§62 Agent Mode**                    | 멀티파일 자율 편집: 목표 → 계획 → 실행 → 통합 diff 리뷰 | 미착수 |
| **§63 Knowledge Q\&A**                | 볼트 전체 벡터 검색, RAG 파이프라인, 인용 기반 답변      | 미착수 |
| **§64 LLM Interpretation Simulation** | 동일 프롬프트 멀티 모델 비교, A/B 테스트             | 미착수 |
| **§65 MCP Server Integration**        | Model Context Protocol 외부 서비스 통합      | 미착수 |
| **§66 Custom AI Plugin API**          | 커뮤니티 AI 확장을 위한 공개 API                 | 미착수 |

### Collaboration & Infrastructure

| 기능                              | 설명                          | 상태  |
| ------------------------------- | --------------------------- | --- |
| **§68 Real-time Collaboration** | Yjs CRDT 기반, 라이브 커서, 프레즌스   | 미착수 |
| **§69 Plugin Marketplace**      | 커뮤니티 플러그인, Extension API 공개 | 미착수 |
| **§70 Mobile Support**          | Tauri Mobile (iOS/Android)  | 미착수 |

### LLM Skills Specialized

| 기능                            | 설명                           | 상태  |
| ----------------------------- | ---------------------------- | --- |
| **§72 Skills-Dedicated Mode** | LLM Skills 편집에 최적화된 전용 UI 모드 | 미착수 |

---

## 품질 / 기술 부채

| 항목                                     | 상태                   |
| -------------------------------------- | -------------------- |
| CommonMark 공식 테스트 651개                 | 0/651 (미통합)          |
| GFM 공식 테스트 120개                        | 0/120 (미통합)          |
| 수동 성능 측정 5개 (앱 시작, 타이핑 레이턴시, 유휴 메모리 등) | Tauri 릴리즈 빌드 후 측정 필요 |

---

## 추천 착수 순서

1. **Agent Mode (§62)** — 핵심 차별화 기능
2. **Knowledge Q\&A (§63)** — RAG 파이프라인
3. **Canvas (§60)** — 시각적 지식 관리
4. **Real-time Collaboration (§68)** — 팀 사용성
