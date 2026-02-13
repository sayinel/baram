# Baram(바람) — 개발 설계서

> **"가볍다 / 아름답다 / 연결된다"**
>
> Typora의 WYSIWYG 품질 + Obsidian의 확장성 + AI 네이티브 통합

---

## 프로젝트 소개

**Baram(바람)**은 Tauri 2.0 기반의 경량 WYSIWYG 마크다운 에디터입니다. ~10MB의 가벼운 설치 크기로 Electron 기반 에디터(~300MB)의 대안을 제시하며, LLM Skills 편집에 특화된 AI 네이티브 기능을 제공합니다.

**핵심 기술 스택**: Tauri 2.0 · Tiptap/ProseMirror · React · KaTeX · Zustand · Rust

**대상 사용자**:
- 1차: AI/LLM 개발자 (Skills 편집, 프롬프트 엔지니어링)
- 2차: 마크다운 파워 유저 (기술 문서, 논문, 블로그)
- 3차: Notion + 마크다운 혼용 사용자 (수식 호환)

---

## 설계서 구조

본 설계서는 9개 파트로 구성되어 있으며, 전체 약 8,400줄 / 24,000단어 규모입니다.

```
baram-design/
├── README.md                ← 현재 문서 (마스터 목차)
├── part1-overview.md        ← 프로젝트 개요
├── part2-market-analysis.md ← 시장 분석 및 벤치마킹
├── part3-architecture.md    ← 아키텍처 설계
├── part4-uiux.md            ← UI/UX 설계
├── part5-core-features.md   ← 핵심 기능 상세 설계
├── part6-ai-integration.md  ← AI 통합 설계
├── part7-data-models.md     ← 데이터 모델 및 파일 규격
├── part8-roadmap.md         ← 개발 로드맵 및 일정
└── part9-appendix.md        ← 부록
```

---

## 파트별 목차

### [Part 1. 프로젝트 개요](part1-overview.md)

왜 만드는가, 무엇을 만드는가.

| 섹션 | 내용 |
|------|------|
| 1.1 프로젝트 배경 및 동기 | 시장 빈틈, LLM Skills 편집 필요성, Typora 유료화 |
| 1.2 프로젝트 비전 및 목표 | 한 줄 비전, 핵심 가치 3가지, 차별화 전략 |
| 1.3 대상 사용자 (Persona) | 3개 페르소나별 핵심 니즈와 Pain Point |
| 1.4 프로젝트 범위 (Scope) | In-Scope/Out-of-Scope, 지원 플랫폼 |
| 1.5 설계서 구성 안내 | 9부 체계 개요 |

---

### [Part 2. 시장 분석 및 벤치마킹](part2-market-analysis.md)

기존 에디터 조사 결과를 정리하고 Baram의 포지셔닝을 도출한다.

| 섹션 | 내용 |
|------|------|
| 2.1 경쟁 에디터 비교 분석 | Typora, Obsidian, Mark Text, Notion, Logseq 비교 매트릭스 |
| 2.2 Typora 심층 벤치마킹 | 레이아웃, 메뉴 구조, 인터랙션 패턴, 5대 UX 원칙 |
| 2.3 Obsidian 기능 벤치마킹 | 도입 가치 평가, 양방향 링크, 플러그인 아키텍처 |
| 2.4 Logseq 기능 벤치마킹 | 블록 참조, 쿼리, 네임스페이스, 저널 |
| 2.5 2025 UI 트렌드 분석 | Command-First, Floating UI, Hyper-minimalism |
| 2.6 벤치마킹 종합 시사점 | 각 에디터에서 가져올 것 + Baram이 개선할 것 |

---

### [Part 3. 아키텍처 설계](part3-architecture.md)

기술 스택과 시스템 구조를 정의한다.

| 섹션 | 내용 |
|------|------|
| 3.1 기술 스택 확정 | 각 기술 선정 근거, 비교 분석 결과 |
| 3.2 시스템 아키텍처 | 레이어 구조, Tauri IPC 설계, 프론트엔드 구조 |
| 3.3 에디터 엔진 아키텍처 | Tiptap/ProseMirror 내부, Extension 체계, 마크다운 파이프라인 |
| 3.4 Extension-First 아키텍처 | Core Extension 목록, API 설계, Progressive Disclosure |
| 3.5 상태 관리 설계 | Zustand 스토어 구조, 에디터/앱 상태 분리 |
| 3.6 파일 시스템 설계 | File Watcher, 인덱스/캐시, 자동 저장 |

---

### [Part 4. UI/UX 설계](part4-uiux.md)

3-Layer Interaction 모델 기반의 인터페이스 설계.

| 섹션 | 내용 |
|------|------|
| 4.1 디자인 원칙 (7대 원칙) | Typora 5원칙 계승 + 2025 트렌드 추가 |
| 4.2 3-Layer Interaction 모델 | L1 콘텐츠 · L2 컨텍스트 · L3 커맨드 |
| 4.3 전체 레이아웃 설계 | 사이드바, Workspace 프리셋, 반응형 동작 |
| 4.4 메뉴바 설계 (간소화 6-메뉴) | Typora 7-메뉴 → Baram 6-메뉴 재설계 |
| 4.5 상태바 설계 (미니멀) | Git 브랜치, Word Count, Ln:Col |
| 4.6 단축키 설계 | 전체 단축키 맵, Typora 호환, 커스터마이징 |
| 4.7 테마 시스템 설계 | CSS Variables, 기본 3종, 커스텀 테마 |
| 4.8 다이얼로그 및 모달 설계 | 다이얼로그 목록, 설정(Preferences) 패널 |
| 4.9 온보딩 및 빈 상태 설계 | 첫 실행 가이드, 빈 문서/Skills 안내 |

---

### [Part 5. 핵심 기능 상세 설계](part5-core-features.md)

개별 기능의 구현 명세. 설계서에서 가장 큰 파트.

| 섹션 | 내용 |
|------|------|
| 5.1 WYSIWYG 에디터 코어 | "구문 사라짐" 동작 원리, 블록/인라인 요소, 직렬화기 |
| 5.2 테이블 에디터 | Tab 이동, 열 너비 조절, 컨텍스트 메뉴 |
| 5.3 KaTeX 수식 렌더링 | Notion 호환, 인라인/블록 수식, 오버레이 편집, 자동완성 |
| 5.4 코드 블록 | CodeMirror 6 vs Shiki, 언어 감지, 라인 넘버 |
| 5.5 다이어그램 (Mermaid) | Mermaid.js 통합, 실시간 렌더링 |
| 5.6 양방향 링크 시스템 | Wikilink, 백링크, 언링크드 멘션, 블록 참조, 임베드 |
| 5.7 이미지 관리 | 삽입 5가지 방식, 경로 관리, 호버 툴바, 업로드 연동 |
| 5.8 LLM Skills 편집 모드 | YAML 비주얼 에디터, 프롬프트 하이라이팅, diff 뷰, 템플릿 |
| 5.9 검색 시스템 | 문서 내 Find/Replace, 프로젝트 전체 검색 |
| 5.10 내보내기(Export) 시스템 | PDF/HTML/Image + Pandoc 확장 |
| 5.11 커맨드 시스템 | Command Palette, 슬래시 커맨드 |
| 5.12 네비게이션 시스템 | Quick Switcher, 북마크, 히스토리 |
| 5.13 쿼리 블록 | Logseq 스타일 쿼리 |
| 5.14 저널/데일리 노트 | 날짜별 자동 생성, 템플릿 |

---

### [Part 6. AI 통합 설계](part6-ai-integration.md)

5-Level AI 통합 아키텍처. Baram의 핵심 차별화 요소.

| 섹션 | 내용 |
|------|------|
| 6.1 AI 설계 원칙 | 비침투성, 프라이버시, 점진적 통합 |
| 6.2 5-Level AI 통합 아키텍처 | L1 자동완성 → L2 명령 → L3 대화 → L4 에이전트 → L5 커스텀 |
| 6.3 LLM Provider 추상화 레이어 | 멀티 프로바이더, 로컬/클라우드 전환 |
| 6.4 Skills-Aware AI 기능 | Skills 구조 인식, 프롬프트 분석, 차별화 전략 |
| 6.5 AI 구현 로드맵 | Phase별 AI 기능 도입 계획 |

---

### [Part 7. 데이터 모델 및 파일 규격](part7-data-models.md)

파일 포맷, 내부 데이터 구조, 저장 메커니즘.

| 섹션 | 내용 |
|------|------|
| 7.1 마크다운 파일 규격 | YAML frontmatter, 확장 구문, 호환성 정책 |
| 7.2 에디터 내부 데이터 모델 | ProseMirror 노드 스키마, 직렬화/역직렬화 |
| 7.3 앱 설정 파일 구조 | 전역/워크스페이스/문서 설정, JSON 스키마 |
| 7.4 링크 인덱스 / 메타데이터 캐시 | 캐시 구조, 갱신 전략, SQLite 스키마 |
| 7.5 스냅샷 / 버전 관리 데이터 | 자동 스냅샷, diff 저장, Git 연동 |

---

### [Part 8. 개발 로드맵 및 일정](part8-roadmap.md)

Phase별 계획과 마일스톤.

| 섹션 | 내용 |
|------|------|
| 8.1 Phase 정의 (3단계) | Phase 1 Foundation → Phase 2 Power → Phase 3 Intelligence |
| 8.2 마일스톤 정의 | 주요 마일스톤 및 산출물 |
| 8.3 기술 리스크 및 대응 계획 | 리스크 매트릭스, 완화 전략 |
| 8.4 품질 보증 전략 | 테스트 전략, 코드 리뷰, CI/CD |
| 8.5 릴리스 전략 | 버전 정책, 업데이트 채널 |
| 8.6 Phase별 핵심 의존성 체인 | 기능 간 의존 관계 |
| 8.7 성공 지표 (KPI) | 정량적 목표 |

---

### [Part 9. 부록](part9-appendix.md)

참고 자료, 가이드, 레퍼런스.

| 섹션 | 내용 |
|------|------|
| 9.1 Skills 활용 가이드 | 개발 자동화를 위한 Claude Skills 정의 |
| 9.2 용어집 (Glossary) | 프로젝트 전체에서 사용하는 용어 정의 |
| 9.3 단축키 전체 맵 | macOS / Windows / Linux 단축키 Quick Reference |
| 9.4 참고 자료 및 링크 | 기술 문서, 라이브러리, 디자인 참고 |
| 9.5 설계 문서 전체 구조 요약 | 9부 체계 및 섹션 간 참조 관계 |

---

## 분석 자료 (입력 문서)

설계서 작성의 기초가 된 분석 자료:

| 문서 | 설명 |
|------|------|
| [markdown-editor-analysis.md](markdown-editor-analysis.md) | 주요 마크다운 에디터 비교 분석 |
| [typora-interface-analysis.md](typora-interface-analysis.md) | Typora 인터페이스 전수 분석 |
| [obsidian-feature-analysis.md](obsidian-feature-analysis.md) | Obsidian 기능 도입 가치 평가 |
| [logseq-feature-analysis.md](logseq-feature-analysis.md) | Logseq 기능 벤치마킹 |
| [design-document-structure.md](design-document-structure.md) | 설계서 목차 구조 v1.0 |
| [baram-design-document-toc-v2.md](baram-design-document-toc-v2.md) | 설계서 목차 v2.0 (갭 분석 포함) |

---

## 파트별 규모

| 파트 | 줄 수 | 단어 수 |
|------|------:|-------:|
| Part 1. 프로젝트 개요 | 246 | 984 |
| Part 2. 시장 분석 | 447 | 1,985 |
| Part 3. 아키텍처 설계 | 1,124 | 3,600 |
| Part 4. UI/UX 설계 | 1,035 | 2,794 |
| Part 5. 핵심 기능 상세 | 1,873 | 4,075 |
| Part 6. AI 통합 설계 | 1,146 | 2,438 |
| Part 7. 데이터 모델 | 1,405 | 3,532 |
| Part 8. 로드맵 | 665 | 2,389 |
| Part 9. 부록 | 472 | 2,191 |
| **합계** | **8,413** | **23,988** |

---

## 핵심 설계 결정 요약

| 영역 | 결정 | 근거 |
|------|------|------|
| 데스크톱 프레임워크 | Tauri 2.0 | ~10MB vs Electron ~300MB |
| 에디터 엔진 | Tiptap v2 (ProseMirror) | 확장성, 커뮤니티, 스키마 기반 |
| 수식 렌더링 | KaTeX | Notion 호환, 빠른 렌더링 |
| 상태 관리 | Zustand | 경량, 보일러플레이트 최소 |
| UI 모델 | 3-Layer Interaction | L1 콘텐츠 · L2 컨텍스트 · L3 커맨드 |
| AI 통합 | 5-Level 점진적 통합 | L1 자동완성 → L5 커스텀 에이전트 |
| 확장 체계 | Extension-First | 모든 기능이 Extension으로 구현 |
| 기능 수 | 72개 (P1:27 / P2:30 / P3:15) | 3단계 Phase 분할 |

---

## 문서 버전 이력

| 버전 | 날짜 | 변경 내용 |
|------|------|----------|
| v2.0 | 2025-02-12 | 9부 체계 재구성, 3-Layer UI 모델, 5-Level AI 통합, Obsidian/Typora/Logseq 갭 분석 반영 |
| v1.0 | 2025-02-12 | 8부 체계 초안, 기존 분석 자료 기반 목차 구조 정의 |
