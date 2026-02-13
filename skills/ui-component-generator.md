---
name: ui-component-generator
description: "Part 4 UI/UX 설계를 기반으로 Baram의 React 컴포넌트를 생성한다."
version: 1.0.0
tags: [code-gen, react, ui, baram]
input_format: text
output_format: code
---

# Baram UI Component Generator

## 역할

Part 4 UI/UX 설계의 와이어프레임과 스펙을 읽고, Tailwind CSS 기반 React 컴포넌트를 생성한다.

## 참조 설계 문서

- Part 4 §4.1: 7대 디자인 원칙
- Part 4 §4.2: 전체 레이아웃 (3-Column 가변)
- Part 4 §4.3: 사이드바 4가지 모드 (파일트리, 파일목록, 아웃라인, 검색)
- Part 4 §4.4: 탭바
- Part 4 §4.5: 커맨드 팔레트 (Cmd+K)
- Part 4 §4.6: 슬래시 커맨드 (/)
- Part 4 §4.7: 플로팅 서식 툴바
- Part 4 §4.8: 블록 핸들 메뉴, 컨텍스트 메뉴, 상태바, 설정 패널
- Part 4 §4.9: 온보딩, 빈 상태 설계
- Part 3 §3.5: Zustand 스토어 구조

## 입력 형식

```
컴포넌트: CommandPalette
설계 참조: §4.5
Zustand 스토어: uiStore
카테고리: command
```

## 카테고리 매핑

| 설계 섹션 | 카테고리 디렉토리 | 포함 컴포넌트 |
|-----------|------------------|--------------|
| §4.2 | layout/ | AppLayout, Splitter |
| §4.3 | sidebar/ | FileTree, FileList, Outline, SearchPanel, BacklinksPanel |
| §4.4 | layout/ | TabBar, Tab |
| §4.5 | command/ | CommandPalette, CommandItem |
| §4.6 | command/ | SlashMenu, SlashMenuItem |
| §4.7 | toolbar/ | FloatingToolbar, ToolbarButton |
| §4.8 | toolbar/ | BlockHandle, ContextMenu, StatusBar |
| §4.8 | settings/ | SettingsModal, GeneralTab, EditorTab, AITab, ... |
| §4.9 | editor/ | WelcomeScreen, EmptyDocGuide |
| §6.2 | ai/ | AIPanel, InlineAIEdit, GhostText, AIDiffView |

## 출력 규칙

### 컴포넌트 파일 (`src/components/{category}/{Name}.tsx`)

```typescript
'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '@/utils/cn'
import { use{Store} } from '@/stores/{store}'

/**
 * {Name} — {한줄 설명}
 *
 * @ref Part 4 §{섹션}
 * @store {storeName}
 */

interface {Name}Props {
  className?: string
  // 설계 문서에서 필요한 props 추출
}

export function {Name}({ className, ...props }: {Name}Props) {
  // === Zustand 스토어 연결 ===
  const { relevantState, relevantAction } = use{Store}()

  // === 내부 상태 ===
  const [localState, setLocalState] = useState(initialValue)

  // === Refs ===
  const containerRef = useRef<HTMLDivElement>(null)

  // === 키보드 단축키 ===
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Part 9 §9.3 단축키 맵 참조
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  // === 이벤트 핸들러 ===
  const handleAction = useCallback(() => {
    // 구현
  }, [])

  // === 렌더링 ===
  return (
    <div
      ref={containerRef}
      className={cn('baram-{kebab-name}', className)}
      role="{적절한 ARIA role}"
      // 접근성 속성
    >
      {/* Part 4의 와이어프레임을 Tailwind으로 구현 */}
    </div>
  )
}
```

### 테스트 파일 (`src/components/{category}/__tests__/{Name}.test.tsx`)

```typescript
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { {Name} } from '../{Name}'

// Zustand 스토어 모킹
jest.mock('@/stores/{store}', () => ({
  use{Store}: () => ({
    // 테스트에 필요한 상태/액션 모킹
  }),
}))

describe('{Name}', () => {
  test('기본 렌더링', () => {
    render(<{Name} />)
    // 핵심 요소가 표시되는지 확인
  })

  test('키보드 단축키로 열기/닫기', async () => {
    render(<{Name} />)
    // 단축키 시뮬레이션
  })

  test('Zustand 스토어 연동', () => {
    render(<{Name} />)
    // 스토어 상태 변경 → UI 반영 확인
  })

  test('접근성: 키보드 내비게이션', async () => {
    render(<{Name} />)
    // Tab, Arrow, Enter, Escape 동작 확인
  })

  test('접근성: ARIA 속성', () => {
    render(<{Name} />)
    // role, aria-label, aria-expanded 등 확인
  })
})
```

## 7대 디자인 원칙 체크리스트

생성된 컴포넌트가 다음을 준수하는지 확인:

- [ ] **구문 불가시성**: 마크다운 구문이 UI에 노출되지 않음
- [ ] **즉각 반응**: hover, click, keypress에 즉시 피드백
- [ ] **맥락 감응**: 현재 에디터 상태에 맞는 옵션만 표시
- [ ] **점진적 공개**: 기본은 단순, 고급은 확장/설정으로
- [ ] **키보드 우선**: 모든 기능에 키보드 접근 가능
- [ ] **3-Layer**: L1(콘텐츠), L2(컨텍스트 메뉴/툴바), L3(커맨드 팔레트)
- [ ] **미니멀리즘**: 불필요한 UI 요소 없음
