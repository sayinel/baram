# /milestone — 마일스톤 단위 일괄 구현

마일스톤 하나를 지정하면 포함된 모든 기능을 의존성 순서에 따라 구현한다.

## 사용법

```
/milestone M1
/milestone M2
/milestone M3
```

## 인자

- `$ARGUMENTS`: 마일스톤 번호 (M1 ~ M10)

---

## 프로세스

### 1. 마일스톤 분석

`dev/design/part8-roadmap.md`에서 해당 마일스톤의 정보를 추출한다:
- 포함된 기능 목록 (번호, 이름, 설계 섹션 참조)
- 완료 기준
- 성능 기준 (해당 시)

`dev/design/part8-roadmap.md` §8.6에서 의존성 체인을 확인한다.

### 2. 기능 의존성 분석 및 순서 결정

의존성 그래프를 분석하여 구현 순서를 결정한다. 병렬 가능한 기능은 표시한다.

**M1 순서 (프로젝트 셋업):**
1. Tauri 2.0 프로젝트 생성
2. 프론트엔드 설정 (React + Vite + Tailwind + Tiptap + Zustand)
3. 디렉토리 구조 생성
4. Zustand 스토어 스켈레톤 (5개)
5. Rust 모듈 뼈대 + IPC 타입 정의
6. CI/CD 설정

**M2 순서 (기본 편집):**
1. 마크다운 파이프라인 (remark → mdast → ProseMirror) — 모든 Extension의 기반
2. 파일 열기/저장 IPC (Rust) — 독립, 병렬 가능
3. 기본 Node Extensions (heading, paragraph, blockquote, list, taskList, hr, image) — 파이프라인 완료 후
4. 기본 Mark Extensions (bold, italic, code, strike, link) — 파이프라인 완료 후, Node와 병렬
5. InputRule 엔진 — Node/Mark 완료 후
6. PasteRule 엔진 — InputRule과 병렬
7. 자동 저장 — 파일 I/O 완료 후
8. History (Undo/Redo) — Tiptap 내장 설정

**M3 순서 (리치 콘텐츠):**
1. KaTeX 수식 (인라인 + 블록) — §5.3
2. CodeMirror 6 코드 블록 — §5.4, 수식과 병렬
3. 테이블 에디터 — §5.5, 독립
4. YAML Frontmatter — §5.8, 독립
5. Source Code Mode 토글 — 모든 Extension 완료 후

**M4 순서 (UI 프레임워크):**
1. AppLayout (3-Column) — §4.2
2. 파일 트리 사이드바 — §4.3, 레이아웃 완료 후
3. 아웃라인 사이드바 — §4.3, 파일 트리와 병렬
4. 커맨드 팔레트 — §4.5, 독립
5. 슬래시 커맨드 — §4.6, 독립
6. 플로팅 서식 툴바 — §4.7, 독립
7. 블록 핸들 메뉴 — §4.8, 독립
8. 컨텍스트 메뉴 (7종) — 위 요소 완료 후
9. 상태바 — 독립

**M5 순서 (AI Level 2):**
1. LLM Provider 추상화 레이어 (Rust 프록시) — §6.3
2. AI 설정 UI — Provider 완료 후
3. 슬래시 AI 커맨드 7종 — Provider + 슬래시 커맨드 완료 후
4. Cmd+K 인라인 편집 + AI Diff Engine — §6.2
5. 플로팅 툴바 AI 버튼 — 인라인 편집 + 플로팅 툴바 완료 후

**M6 순서 (MVP 릴리스):**
1. PDF 내보내기
2. HTML 내보내기
3. 성능 최적화 (벤치마크 기준 미달 항목)
4. 크로스 플랫폼 테스트
5. 릴리스 빌드 설정

### 3. 순차 실행

각 기능에 대해 `/implement` 워크플로우(Brainstorm → Plan → Execute)를 순서대로 실행한다.

기능 간 의존하는 타입/인터페이스를 자동으로 연결한다.
`registry.json`과 `ipc-registry.json`을 계속 업데이트한다.

### 4. 통합 테스트

마일스톤의 모든 기능이 함께 동작하는 통합 테스트를 생성한다.
- M2: .md 파일 열기 → WYSIWYG 편집 → 저장 → 라운드트립 검증
- M3: 수식/코드/테이블 포함 문서 편집 + 라운드트립
- M4: 모든 UI 요소가 동시에 동작하는 시나리오
- M5: AI 인라인 편집 flow (선택 → Cmd+K → 지시 → diff → 수락/거절)
- M6: 전체 사용자 flow (열기 → 편집 → AI → 내보내기)

### 5. 마일스톤 완료 보고

```markdown
# Milestone {번호} 완료 보고

## 생성된 파일
- (파일 목록)

## 테스트 결과
- 단위 테스트: X/Y pass
- 라운드트립: X/Y pass
- 통합 테스트: X/Y pass

## 성능 (Part 8 §8.4 기준)
- (해당 지표와 측정값)

## 남은 TODO
- (있는 경우)
```

`dev/progress.json`을 업데이트한다.
