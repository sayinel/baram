# /new-component — React UI 컴포넌트 생성

Part 4 UI/UX 설계를 기반으로 React 컴포넌트를 생성한다.

## 사용법

```
/new-component CommandPalette --ref §4.5 --store uiStore
/new-component FloatingToolbar --ref §4.7 --store editorStore
/new-component FileTree --ref §4.3 --store fileStore
```

## 인자

- `$ARGUMENTS`: 컴포넌트 이름과 옵션
  - 이름: PascalCase
  - `--ref`: 설계 문서 섹션 번호
  - `--store`: 연결할 Zustand 스토어 (editorStore, fileStore, uiStore, settingsStore, aiStore)

---

## 생성 파일

### 1. 컴포넌트 파일

`src/components/{category}/{PascalName}.tsx`

카테고리는 설계 문서 섹션에 따라 자동 결정:
- §4.2 레이아웃 → `layout/`
- §4.3 사이드바 → `sidebar/`
- §4.5~§4.6 커맨드 → `command/`
- §4.7~§4.8 툴바 → `toolbar/`
- §4.9 설정 → `settings/`
- §6.2 AI → `ai/`

```typescript
import { use{Store} } from '@/stores/{store}'

interface {PascalName}Props {
  // 설계 문서에서 필요한 props 추출
}

export function {PascalName}({ ...props }: {PascalName}Props) {
  // Zustand 스토어 연결
  const { ... } = use{Store}()

  // 키보드 단축키 바인딩 (해당 시)
  useEffect(() => {
    // Part 9 §9.3 단축키 맵 참조
  }, [])

  return (
    <div className="baram-{kebab-name}">
      {/* Part 4의 ASCII 와이어프레임을 React로 변환 */}
    </div>
  )
}
```

### 2. 테스트 파일

`src/components/{category}/__tests__/{PascalName}.test.tsx`

```typescript
import { render, screen, fireEvent } from '@testing-library/react'
import { {PascalName} } from '../{PascalName}'

describe('{PascalName}', () => {
  test('렌더링', () => {
    render(<{PascalName} />)
    // 기본 렌더링 확인
  })

  test('키보드 단축키', () => {
    // 설계 문서에 정의된 단축키 동작 테스트
  })

  test('Zustand 스토어 연동', () => {
    // 스토어 상태 변경 시 UI 반영 확인
  })

  test('접근성', () => {
    // ARIA 속성, 키보드 네비게이션
  })
})
```

### 3. 타입 파일 (필요 시)

`src/types/{kebab-name}.ts` — 컴포넌트에서 사용하는 타입이 공유될 때

---

## 디자인 원칙 (Part 4 §4.1)

생성 시 다음 7대 원칙을 준수한다:
1. **구문 불가시성** — 마크다운 구문이 보이지 않는 깔끔한 UI
2. **즉각 반응** — 모든 인터랙션에 즉시 피드백
3. **맥락 감응** — 현재 컨텍스트에 맞는 UI 표시
4. **점진적 공개** — 기본은 단순하게, 고급은 필요할 때
5. **키보드 우선** — 모든 기능은 키보드로 접근 가능
6. **3-Layer Interaction** — L1 콘텐츠 / L2 컨텍스트 / L3 커맨드
7. **미니멀리즘** — 불필요한 UI 요소 배제
