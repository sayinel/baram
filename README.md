# Baram × Claude Code 자동화 패키지

Baram 마크다운 에디터 개발을 위한 Claude Code 자동화 파일 모음입니다.

## 📦 패키지 구조

```
baram-automation/
├── CLAUDE.md                        # 프로젝트 루트 컨텍스트 (필수)
├── README.md                        # 이 파일
│
├── .claude/commands/                # 슬래시 커맨드 (7개)
│   ├── implement.md                 # /implement §X.X — Brainstorm→Plan→Execute
│   ├── milestone.md                 # /milestone MX — 마일스톤 일괄 구현
│   ├── new-extension.md             # /new-extension — Tiptap Extension 생성
│   ├── new-component.md             # /new-component — React 컴포넌트 생성
│   ├── new-ipc.md                   # /new-ipc — Rust IPC 커맨드 생성
│   ├── roundtrip-test.md            # /roundtrip-test — 라운드트립 검증
│   ├── spec-check.md               # /spec-check — 설계서↔코드 일치 검증
│   └── perf-bench.md               # /perf-bench — 성능 벤치마크
│
├── skills/                          # Claude Code Skills (4개)
│   ├── baram-scaffold.md            # M1 프로젝트 초기화 스킬
│   ├── tiptap-extension-generator.md # Extension 코드 생성 스킬
│   ├── ui-component-generator.md    # React 컴포넌트 생성 스킬
│   └── spec-to-code.md             # 설계 문서 → 코드 브릿지 스킬
│
├── src/extensions/
│   ├── CLAUDE.md                    # Extension 영역 컨텍스트
│   └── registry.json               # Extension 메타데이터 레지스트리
│
├── src-tauri/
│   ├── CLAUDE.md                    # Rust 백엔드 영역 컨텍스트
│   └── ipc-registry.json           # IPC 커맨드/이벤트 레지스트리
│
└── docs/
    └── progress.json               # 마일스톤별 진행 상황 추적
```

## 🚀 설치 방법

### 1단계: Baram 프로젝트 생성

```bash
# Tauri 프로젝트 생성
npm create tauri-app@latest baram -- --template react-ts
cd baram
```

### 2단계: 자동화 파일 배치

```bash
# 이 패키지를 다운로드/압축 해제 후:

# 루트 CLAUDE.md
cp baram-automation/CLAUDE.md ./CLAUDE.md

# 슬래시 커맨드
mkdir -p .claude/commands
cp baram-automation/.claude/commands/*.md .claude/commands/

# 스킬 (프로젝트 루트 또는 원하는 위치에)
mkdir -p skills
cp baram-automation/skills/*.md skills/

# 영역별 CLAUDE.md
cp baram-automation/src/extensions/CLAUDE.md src/extensions/CLAUDE.md
cp baram-automation/src-tauri/CLAUDE.md src-tauri/CLAUDE.md

# 레지스트리
cp baram-automation/src/extensions/registry.json src/extensions/registry.json
cp baram-automation/src-tauri/ipc-registry.json src-tauri/ipc-registry.json

# 진행 상황 추적
mkdir -p docs
cp baram-automation/docs/progress.json docs/progress.json
```

### 3단계: 설계 문서 배치

9-part 설계 문서를 `docs/design/` 디렉토리에 배치합니다:

```bash
mkdir -p docs/design
# part1-overview.md ~ part9-appendix.md를 복사
```

### 4단계: Claude Code 시작

```bash
claude   # Claude Code 실행
```

## 🎯 사용 방법

### 프로젝트 시작 (M1)

```
> /milestone M1
```

### 기능 단위 구현

```
> /implement §5.3 수식 편집
```

### Extension 빠르게 생성

```
> /new-extension MathBlock --type Node --syntax "$$...$$" --ref §5.3 --nodeview
```

### UI 컴포넌트 생성

```
> /new-component CommandPalette --ref §4.5 --store uiStore
```

### IPC 커맨드 추가

```
> /new-ipc llm_complete --module llm --input "prompt: string" --output stream --ref §6.3
```

### 품질 검증

```
> /roundtrip-test          # 라운드트립 보존 검증
> /spec-check §5.3         # 설계서 ↔ 코드 일치 확인
> /perf-bench              # 성능 벤치마크
```

### 마일스톤 일괄 실행

```
> /milestone M2            # 기본 편집 전체 구현
> /milestone M3            # 리치 콘텐츠 전체 구현
```

## 📋 파일별 역할

| 파일 | 역할 | 언제 사용 |
|------|------|----------|
| `CLAUDE.md` (루트) | 프로젝트 전체 컨텍스트 | Claude Code 실행 시 자동 로드 |
| `CLAUDE.md` (영역별) | 모듈별 규칙 | 해당 디렉토리 작업 시 자동 로드 |
| `registry.json` | Extension 목록 | Extension 추가/조회 시 |
| `ipc-registry.json` | IPC 커맨드 목록 | Rust↔TS 연동 추가/조회 시 |
| `progress.json` | 진행 상황 | `/milestone`, `/implement` 완료 시 자동 업데이트 |
| `/implement` | Brainstorm→Plan→TDD 워크플로우 | 기능 하나를 구현할 때 |
| `/milestone` | 마일스톤 일괄 실행 | 마일스톤 전체를 한번에 |
| `/new-extension` | Extension 4파일 자동 생성 | 새 Extension 추가 시 |
| `/new-component` | React 컴포넌트 자동 생성 | 새 UI 컴포넌트 추가 시 |
| `/new-ipc` | Rust+TS IPC 양쪽 생성 | 새 백엔드 기능 추가 시 |
| `/roundtrip-test` | MD→PM→MD 무손실 검증 | Extension 구현 후, 릴리스 전 |
| `/spec-check` | 설계서 vs 코드 차이 점검 | 구현 완료 후 검증 |
| `/perf-bench` | 성능 기준 달성 확인 | M6 릴리스 전, 최적화 시 |
| `baram-scaffold` 스킬 | 프로젝트 초기 스캐폴딩 | M1에서 한 번만 |
| `tiptap-extension-generator` 스킬 | Extension 코드 패턴 지식 | `/new-extension`이 참조 |
| `ui-component-generator` 스킬 | UI 컴포넌트 패턴 지식 | `/new-component`가 참조 |
| `spec-to-code` 스킬 | 설계→코드 변환 지식 | `/implement`가 참조 |
