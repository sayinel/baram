# CI/CD Optimization Design

**Date**: 2026-03-11
**Branch**: `chore/project-cleanup`
**Status**: Approved

## Overview

Baram 프로젝트의 CI/CD 파이프라인을 전면 재설계한다.
목표: 속도(병렬화), 정확성(검증 범위 확대), 보안(시크릿 탐지 + 공급망 보호), 코드 중복 제거.

## Section 1: Composite Actions

코드 중복 제거를 위해 재사용 가능한 composite action 2개를 생성한다.

### `.github/actions/setup-node/action.yml`

- `actions/checkout@v6`
- `actions/setup-node@v6` (`.node-version` 파일 자동 감지, npm 캐시)
- `npm ci`

### `.github/actions/setup-tauri/action.yml`

- `actions/checkout@v6`
- `dtolnay/rust-toolchain@v1` (stable)
- `Swatinem/rust-cache@v2` (workspaces: `src-tauri`)
- Tauri 시스템 의존성 설치 (Ubuntu: `libwebkit2gtk-4.1-dev` 등)

## Section 2: ci.yml — 병렬 + 보안 + 최신 버전

### Action 버전 (2025년 3월 기준)

| Action | Version | Note |
|--------|---------|------|
| `actions/checkout` | v6 | v6.0.2 |
| `actions/setup-node` | v6 | v6.3.0, `.node-version` 자동 감지 |
| `dorny/paths-filter` | v3 | v3.0.2, SHA 피닝 |
| `Swatinem/rust-cache` | v2 | v2.8.2, SHA 피닝 |
| `dtolnay/rust-toolchain` | v1 | stable tag, SHA 피닝 |
| `gitleaks/gitleaks-action` | v2 | v2.3.9, SHA 피닝 |

### 트리거

```yaml
on:
  pull_request:
    branches: [main]
  push:
    branches: [main]
  workflow_call:          # release.yml에서 재사용

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

permissions:
  contents: read
```

### Job 의존성 그래프 (최대 병렬화)

```
                      +---> lint ----------+
                      |                    |
changes --(frontend)--+---> typecheck -----+
                      |                    +---> PR merge gate
                      +---> test ----------+
                                           |
changes --(rust)-------> rust-check -------+
                                           |
(always, independent)--> security ---------+
```

- 6개 job, 5개 동시 실행
- 예상 wall time: ~3분 (순차 ~10분 대비 ~3x 단축)

### Job 상세

**Job 1: `changes`** — Path filtering (항상 실행, ~10s)
- `dorny/paths-filter@v3` 사용
- outputs: `frontend` (src/**, package.json, tsconfig.json, *.config.*), `rust` (src-tauri/**)

**Job 2: `lint`** — Frontend 코드 품질 (needs: changes, if: frontend)
- Composite `setup-node` 사용
- prettier --check → eslint --max-warnings=0 → stylelint → knip --reporter compact

**Job 3: `typecheck`** — TypeScript 타입 검증 (needs: changes, if: frontend)
- Composite `setup-node` 사용
- tsc --noEmit

**Job 4: `test`** — 프론트엔드 테스트 (needs: changes, if: frontend)
- Composite `setup-node` 사용
- vitest run

**Job 5: `rust-check`** — Rust 코드 품질 + 테스트 (needs: changes, if: rust)
- Composite `setup-tauri` 사용
- cargo fmt --check → cargo clippy -- -D warnings → cargo test

**Job 6: `security`** — 시크릿 탐지 (항상 실행, 독립)
- `actions/checkout@v6` with `fetch-depth: 0`
- `gitleaks/gitleaks-action@v2`
- 200+ 패턴: API 키, 토큰, 프라이빗 키, DB 접속 문자열

### 시나리오별 동작

| 시나리오 | ci.yml | release.yml |
|----------|--------|-------------|
| PR 생성/업데이트 | `pull_request` → 실행 | — |
| main에 merge (push) | `push: branches: [main]` → 실행 | — |
| 태그 push (`v*`) | — (직접 트리거 안됨) | CI 호출 후 빌드 |

main merge 시 CI 중복 실행은 의도적 — merge conflict로 깨질 수 있으므로 main 보호 우선.

## Section 3: release.yml — CI 호출 후 빌드

### 구조

```yaml
on:
  push:
    tags: ['v*']

permissions:
  contents: write

concurrency:
  group: release-${{ github.ref }}
  cancel-in-progress: false   # 릴리스는 취소하지 않음
```

### 전략

1. `ci.yml`을 `workflow_call`로 재사용 → 전체 검증
2. CI 통과 후 3-platform 빌드 (matrix: ubuntu, macos, windows)
3. `tauri-apps/tauri-action@v0`으로 빌드 + Draft Release 생성
4. `fail-fast: false` — 하나 실패해도 나머지 계속

## Section 4: Security Hardening

### SHA 피닝 (공급망 공격 방지)

| 구분 | 전략 |
|------|------|
| 1st-party (actions/*) | 메이저 태그 (v6) — GitHub 소유, 신뢰 |
| 3rd-party | SHA 피닝 + 태그 주석 |

서드파티 SHA 피닝 대상:
- `dorny/paths-filter` → SHA # v3.0.2
- `gitleaks/gitleaks-action` → SHA # v2.3.9
- `Swatinem/rust-cache` → SHA # v2.8.2
- `dtolnay/rust-toolchain` → SHA # v1

### 보안 계층 요약

| 방어 계층 | 도구/설정 | 방어 대상 |
|-----------|-----------|-----------|
| 시크릿 탐지 | gitleaks v2 | 하드코딩된 API 키, 토큰, 비밀번호 |
| 최소 권한 | `permissions: contents: read` | 토큰 탈취 시 피해 최소화 |
| 공급망 보호 | SHA 피닝 (3rd-party) | 악성 태그 변조 공격 |
| 의존성 보안 | Dependabot (이미 설정됨) | 취약한 npm/cargo 패키지 |
| 동시 실행 | `cancel-in-progress` | 리소스 낭비 방지 |
| Fork 격리 | GitHub 기본 + 명시적 permissions | Fork PR의 시크릿 접근 차단 |
