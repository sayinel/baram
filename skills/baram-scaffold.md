---
name: baram-scaffold
description: "Baram 프로젝트의 전체 스캐폴딩을 생성한다. M1 마일스톤 전용."
version: 1.0.0
tags: [scaffold, tauri, baram, init]
input_format: text
output_format: code
---

# Baram Project Scaffold

## 역할

Baram 마크다운 에디터 프로젝트의 전체 초기 스캐폴딩을 생성한다.
이 스킬은 M1 마일스톤(프로젝트 셋업)에서 한 번만 실행한다.

## 참조 설계 문서

- Part 3 §3.1: 기술 스택 (Tauri 2.0, React 19, Tiptap v2, Zustand 등)
- Part 3 §3.2: 시스템 아키텍처, IPC 설계
- Part 3 §3.5: Zustand 스토어 구조 (5개 스토어)
- Part 3 §3.6: Vault 파일 시스템 구조
- Part 8 §8.2: M1 산출물 정의

## 실행 순서

### Step 1: Tauri 2.0 프로젝트 생성

```bash
npm create tauri-app@latest baram -- --template react-ts
cd baram
```

Cargo.toml 핵심 의존성:
```toml
[dependencies]
tauri = { version = "2", features = ["tray-icon", "protocol-asset"] }
tauri-plugin-fs = "2"
tauri-plugin-dialog = "2"
tauri-plugin-shell = "2"
tauri-plugin-updater = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tokio = { version = "1", features = ["full"] }
rusqlite = { version = "0.31", features = ["bundled"] }
tantivy = "0.22"
notify = "6"
git2 = "0.18"
reqwest = { version = "0.12", features = ["stream", "json"] }
thiserror = "1"
uuid = { version = "1", features = ["v4"] }
chrono = { version = "0.4", features = ["serde"] }
```

### Step 2: 프론트엔드 설정

```bash
# Tiptap
npm install @tiptap/core @tiptap/react @tiptap/starter-kit @tiptap/pm
npm install @tiptap/extension-placeholder @tiptap/extension-history

# 상태 관리
npm install zustand

# 수식
npm install katex
npm install -D @types/katex

# 스타일
npm install -D tailwindcss @tailwindcss/vite

# 마크다운 파이프라인
npm install unified remark-parse remark-stringify remark-gfm remark-math

# 개발 도구
npm install -D @testing-library/react @testing-library/jest-dom
npm install -D jest ts-jest @types/jest
npm install -D eslint prettier eslint-config-prettier
npm install -D @commitlint/cli @commitlint/config-conventional husky
```

TypeScript strict mode 활성화:
```json
// tsconfig.json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": false
  }
}
```

### Step 3: 디렉토리 구조 생성

프로젝트 루트의 CLAUDE.md에 정의된 전체 디렉토리 구조를 생성한다.
각 디렉토리에 `index.ts` (배럴 파일)을 배치한다.

### Step 4: Zustand 스토어 스켈레톤 (5개)

Part 3 §3.5의 설계를 기반으로 5개 스토어의 스켈레톤을 생성한다.

**editorStore**: 활성 탭, dirty 상태, 에디터 인스턴스 참조
**fileStore**: 열린 파일 목록, 파일 트리, Vault 경로
**uiStore**: 사이드바 상태, 패널 가시성, 모달 상태, 테마
**settingsStore**: 사용자 설정, Extension 활성화 상태
**aiStore**: LLM provider 설정, 스트리밍 상태, Ghost Text

### Step 5: Rust 모듈 뼈대

```
src-tauri/src/
├── main.rs          ← Tauri 앱 초기화, invoke_handler 등록
├── lib.rs           ← 모듈 선언
├── commands/
│   ├── mod.rs
│   ├── fs_cmd.rs    ← read_file, write_file, list_dir
│   └── config_cmd.rs ← get_config, set_config
├── fs/
│   └── mod.rs       ← 파일 I/O 로직, 원자적 쓰기
└── config/
    └── mod.rs       ← .baram/config.json 관리
```

### Step 6: 기본 Tiptap 에디터 인스턴스

StarterKit만 포함된 최소 에디터:

```typescript
// src/components/editor/Editor.tsx
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'

export function Editor() {
  const editor = useEditor({
    extensions: [StarterKit],
    content: '',
  })

  return <EditorContent editor={editor} className="baram-editor" />
}
```

### Step 7: CI/CD

GitHub Actions 워크플로우:
- `ci.yml`: 3-OS 매트릭스 (macOS, Windows, Ubuntu)에서 빌드 + 린트 + 테스트
- `release.yml`: 태그 push 시 크로스 플랫폼 릴리스 빌드

### Step 8: 개발 환경 설정 파일

- `.eslintrc.json`: TypeScript + React 규칙
- `.prettierrc`: 2스페이스, 세미콜론, 싱글쿼트
- `commitlint.config.js`: Conventional Commits 검증
- `.husky/pre-commit`: 린트 + 테스트
- `.gitignore`: node_modules, target, .baram, dist

## M1 완료 기준

- [ ] macOS/Windows/Linux에서 빈 에디터 창이 실행된다
- [ ] 텍스트 입력이 가능하다
- [ ] `tauri dev`로 핫 리로드 개발이 동작한다
- [ ] CI가 3개 OS에서 빌드 성공한다
- [ ] 모든 설정 파일이 올바르게 구성되었다
