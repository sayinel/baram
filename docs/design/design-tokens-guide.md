# 디자인 토큰 가이드

**대상 독자**: 새로운 팀 멤버 및 디자인 토큰 시스템 유지보수자

이 문서는 Baram의 디자인 토큰 시스템을 설명합니다. W3C DTCG 포맷을 따르는 3계층 구조와 Style Dictionary v5 기반 자동 생성 파이프라인을 통해 색상 값을 관리합니다.

---

## 1. 토큰 계층 구조

디자인 토큰은 3 단계의 추상화 계층을 거쳐 컴포넌트에 도달합니다:

```
┌─────────────────────────────────────────┐
│ 1. 원시 값 (Primitive)                   │
│   tokens/primitive/*.json               │
│   raw colors, spacing, typography      │
│   예: #3b82f6, 16px, 'Inter'           │
└────────────────┬────────────────────────┘
                 │ (Reference)
                 ▼
┌─────────────────────────────────────────┐
│ 2. 의미론적 값 (Semantic)               │
│   tokens/semantic/color-light.json      │
│   tokens/semantic/color-dark.json       │
│   "이 값이 무엇인가"를 표현             │
│   예: --color-accent-default            │
└────────────────┬────────────────────────┘
                 │ (Style Dictionary)
                 ▼
┌─────────────────────────────────────────┐
│ 3. CSS 변수 (Generated CSS)             │
│   src/styles/generated/*.css            │
│   자동 생성, 수동 수정 금지             │
│   예: :root { --color-text-primary: ... │
└────────────────┬────────────────────────┘
                 │ (var() reference)
                 ▼
┌─────────────────────────────────────────┐
│ 4. 컴포넌트 스타일 (Component)          │
│   src/styles/*.css, src/components/**   │
│   var(--color-text-primary) 사용       │
└─────────────────────────────────────────┘
```

### 계층별 목적

| 계층 | 파일 위치 | 수정 권한 | 목적 |
|------|---------|---------|------|
| **Primitive** | `tokens/primitive/*.json` | ✓ 수정 | raw color scale (Tailwind 기반), spacing, typography 정의 |
| **Semantic** | `tokens/semantic/color-light.json`, `color-dark.json` | ✓ 수정 | 의미론적 이름으로 색상 매핑 (라이트/다크 테마별) |
| **Generated** | `src/styles/generated/*.css` | ✗ 금지 | Style Dictionary가 자동 생성 (직접 수정 불가) |
| **Component** | `src/styles/*.css`, `src/components/**` | ✓ 수정 | CSS 변수를 참조하여 스타일 적용 |

---

## 2. 파일 맵 (File Map)

### 2.1 원본 (Source of Truth)

모든 색상 값은 이 3개 파일에 정의됩니다:

#### `tokens/primitive/color.json`
- **목적**: 원시 색상 팔레트
- **포맷**: W3C DTCG (`$value`, `$type`)
- **내용**:
  - `color.white`, `color.black`
  - `color.blue` (50~950), `color.gray`, `color.slate`, `color.red` 등 (각 11단계)
  - `color.violet`, `color.amber`, `color.emerald` 등 보조 색상
- **예시**:
  ```json
  {
    "color": {
      "$type": "color",
      "blue": {
        "500": { "$value": "#3b82f6" }
      }
    }
  }
  ```

#### `tokens/semantic/color-light.json`
- **목적**: 라이트 테마 의미론적 색상 매핑
- **포맷**: W3C DTCG (Primitive 참조 지원)
- **25개 키** (Theme System 섹션 참고):
  - Background: `bg.default`, `bg.subtle`, `bg.panel`, `bg.elevated`, `bg.input`
  - Text: `text.primary`, `text.secondary`, `text.disabled`, `text.muted`
  - Border: `border.default`, `border.subtle`
  - Accent: `accent.default`, `accent.hover`, `accent.subtle`, `accent.ai`
  - Editor: `editor.bg`, `editor.text`, `editor.selection`, `editor.cursor`, `editor.line-highlight`
  - Status: `status.danger`, `status.warning`, `status.success`
  - Graph: `graph.node`, `graph.active`, `graph.edge`
- **예시**:
  ```json
  {
    "color": {
      "bg": {
        "default": {
          "$value": "{color.white}",
          "$description": "Main background"
        }
      }
    }
  }
  ```

#### `tokens/semantic/color-dark.json`
- **목적**: 다크 테마 의미론적 색상 매핑
- **포맷**: color-light.json과 동일 구조, 값은 다름
- **예시**:
  ```json
  {
    "color": {
      "bg": {
        "default": {
          "$value": "#1a1a2e",
          "$description": "Main background (dark)"
        }
      }
    }
  }
  ```

#### `src/types/theme.ts`
- **목적**: TypeScript 타입 정의 + 8개 내장 테마 데이터
- **내용**:
  - `ThemeColors`: 25개 CSS 변수 키 인터페이스
  - `THEME_COLOR_KEYS`: 색상 선택 UI 메타데이터 (카테고리, 레이블)
  - `BUILT_IN_THEMES`: 8개 테마 정의
    - Default Light, Default Dark
    - Tokyo Night, Solarized Light, Solarized Dark, Nord
    - Baram Garden Light, Baram Garden Dark
- **마이그레이션**: v10 (v9→v10: 이전 CSS 변수 키명 → 새 키명)

#### `tokens/tokens-studio.json`
- **목적**: Figma Tokens Studio 호환 export
- **유지보수**: `npm run tokens:export` 생성 (자동)
- **용도**: Figma 설계자와 동기화

### 2.2 생성된 파일 (Generated — 수정 금지)

Style Dictionary가 `npm run tokens:build` 실행 시 자동 생성합니다:

#### `src/styles/generated/primitives.css`
- **포맷**: Tailwind 4 호환 `@theme { }` 블록
- **내용**: Primitive 원시 색상 (blue-500, gray-100 등)
- **예시**:
  ```css
  @theme {
    --color-blue-500: #3b82f6;
    --color-gray-100: #f3f4f6;
  }
  ```

#### `src/styles/generated/semantic-light.css`
- **포맷**: `:root { }` 선택자 내 CSS 변수
- **내용**: 25개 의미론적 색상 (라이트 테마)
- **예시**:
  ```css
  :root {
    --color-bg-default: var(--color-white);
    --color-text-primary: #1a1a1a;
  }
  ```

#### `src/styles/generated/semantic-dark.css`
- **포맷**: `[data-theme="dark"] { }` 선택자 내 CSS 변수
- **내용**: 25개 의미론적 색상 (다크 테마)
- **예시**:
  ```css
  [data-theme="dark"] {
    --color-bg-default: #1a1a2e;
    --color-text-primary: #e2e8f0;
  }
  ```

#### `src/styles/generated/system-dark.css`
- **포맷**: `@media (prefers-color-scheme: dark)` 미디어 쿼리
- **내용**: 시스템 다크모드 폴백 (명시적 `data-theme` 없을 때)
- **예시**:
  ```css
  @media (prefers-color-scheme: dark) {
    html:not([data-theme="light"], [data-theme="dark"]) {
      --color-bg-default: #1a1a2e;
    }
  }
  ```

### 2.3 빌드 파이프라인

#### `style-dictionary.config.ts`
- **목적**: Style Dictionary v5 설정
- **역할**:
  - 4개 출력 파일 경로 지정
  - Primitive → `@theme` 포맷 변환
  - Semantic → `:root` / `[data-theme="dark"]` 포맷 변환
  - Semantic → `@media` 포맷 변환
- **커스텀 포맷**: `css/tailwind-theme`, `css/media-prefers-dark` 등록
- **실행**: `npx tsx style-dictionary.config.ts` (또는 `npm run tokens:build`)

### 2.4 소비처 (Consumer — var() 참조만)

#### CSS 파일 (`src/styles/*.css`)
- `src/styles/base.css`: 기본 스타일, 공유 유틸리티 클래스, shadow 토큰
- `src/styles/editor.css`, `layout.css`, `file-tree.css` 등: 컴포넌트별 스타일
- **규칙**: 모든 색상은 `var(--color-*)` 으로만 참조

#### React 컴포넌트 (`src/components/**/*.tsx`)
- 인라인 스타일에서 `var(--color-*)` 사용 가능
- **예시**:
  ```tsx
  <div style={{ color: "var(--color-text-primary)" }}>...</div>
  ```

---

## 3. 새 토큰 추가하기 (Step-by-Step)

### 단계 1: Semantic JSON에 추가

light 및 dark 버전을 모두 정의합니다:

**`tokens/semantic/color-light.json`**
```json
{
  "color": {
    "myCategory": {
      "myToken": {
        "$value": "{color.blue.500}",
        "$description": "Description of what this token means"
      }
    }
  }
}
```

**`tokens/semantic/color-dark.json`**
```json
{
  "color": {
    "myCategory": {
      "myToken": {
        "$value": "{color.blue.600}",
        "$description": "Description of what this token means (dark)"
      }
    }
  }
}
```

### 단계 2: 토큰 빌드

```bash
npm run tokens:build
```

이 명령은 `src/styles/generated/` 의 4개 파일을 재생성합니다.

### 단계 3: 생성된 CSS 확인

```bash
grep "myCategory-myToken" src/styles/generated/semantic-light.css
```

output:
```css
--color-myCategory-myToken: var(--color-blue-500);
```

### 단계 4: 테마 시스템에 추가 (테마 선택 가능하게 하려면)

이 단계는 **사용자가 테마 설정에서 색상을 커스터마이즈할 수 있게 하려는 경우만** 필요합니다.

#### 4a. `src/types/theme.ts`의 `ThemeColors` 인터페이스에 추가

```typescript
export interface ThemeColors {
  // ... 기존 25개 ...
  "--color-myCategory-myToken": string;
}
```

#### 4b. `THEME_COLOR_KEYS`에 메타데이터 추가

```typescript
export const THEME_COLOR_KEYS = [
  // ... 기존 ...
  {
    key: "--color-myCategory-myToken",
    label: "My Token",
    category: "My Category",
  },
];
```

#### 4c. 8개 `BUILT_IN_THEMES` 모두에 값 추가

```typescript
const BUILT_IN_THEMES: ThemeDef[] = [
  {
    id: "default-light",
    // ...
    colors: {
      // ... 기존 25개 ...
      "--color-myCategory-myToken": "#3b82f6",
    },
  },
  // ... 나머지 7개 테마 ...
];
```

#### 4d. Store 마이그레이션 버전 업그레이드

`src/stores/settings/store.ts` 에서 `SETTINGS_VERSION` 을 1 증가:

```typescript
const SETTINGS_VERSION = 11; // was 10
```

### 단계 5: CSS에서 사용

```css
.myComponent {
  color: var(--color-myCategory-myToken);
}
```

### 단계 6: 검증

```bash
npm run audit:css-vars
```

만약 "All CSS variables are defined" 라는 메시지가 나오면 성공입니다.

---

## 4. 테마 시스템 (Theme System)

### 개요

Baram은 8개의 **내장 테마**(built-in)와 사용자 정의 테마를 지원합니다. 각 테마는 25개의 CSS 변수를 정의합니다.

### 내장 테마

| ID | 이름 | Base | 특징 |
|---|---|---|---|
| `default-light` | Default Light | light | 표준 라이트 모드 |
| `default-dark` | Default Dark | dark | 표준 다크 모드 |
| `tokyo-night` | Tokyo Night | dark | 따뜻한 톤의 다크 테마 (유명) |
| `solarized-light` | Solarized Light | light | 눈 친화적 라이트 테마 |
| `solarized-dark` | Solarized Dark | dark | 눈 친화적 다크 테마 |
| `nord` | Nord | dark | 차가운 톤의 다크 테마 |
| `baram-garden-light` | Baram Garden Light | light | Baram 커스텀 라이트 테마 |
| `baram-garden-dark` | Baram Garden Dark | dark | Baram 커스텀 다크 테마 |

### ThemeColors 인터페이스 (25개 키)

```typescript
interface ThemeColors {
  // Background (5)
  "--color-bg-default": string;
  "--color-bg-subtle": string;
  "--color-bg-panel": string;
  "--color-bg-elevated": string;
  "--color-bg-input": string;

  // Text (4)
  "--color-text-primary": string;
  "--color-text-secondary": string;
  "--color-text-disabled": string;

  // Border (2)
  "--color-border-default": string;
  "--color-border-subtle": string;

  // Accent (4)
  "--color-accent-default": string;
  "--color-accent-hover": string;
  "--color-accent-subtle": string;
  "--color-accent-ai": string;

  // Editor (5)
  "--color-editor-bg": string;
  "--color-editor-text": string;
  "--color-editor-selection": string;
  "--color-editor-cursor": string;
  "--color-editor-line-highlight": string;

  // Status (3)
  "--color-status-danger": string;
  "--color-status-warning": string;
  "--color-status-success": string;

  // Graph (3)
  "--color-graph-node": string;
  "--color-graph-active": string;
  "--color-graph-edge": string;
}
```

### 테마 활성화

#### 자동 (시스템 기본값 따르기)
시스템 `prefers-color-scheme` 을 따릅니다 → `src/styles/generated/system-dark.css` 적용

#### 명시적 (사용자 선택)
HTML 루트 요소에 `data-theme` 속성 설정:

```html
<html data-theme="tokyo-night">
</html>
```

이 경우 `src/styles/generated/semantic-dark.css` 내 `[data-theme="dark"]` 규칙이 적용됩니다.

### 설정 스토어와의 연동

`src/stores/settings/store.ts` (Zustand):

```typescript
const useSettingsStore = create<SettingsState>((set) => ({
  activeThemeId: "default-light", // 활성 테마 ID
  customThemes: [],               // 사용자 정의 테마
  // ...
}));
```

**Theme Switch 흐름**:
1. 사용자가 Settings > Appearance 에서 테마 선택
2. `setActiveTheme(themeId)` 호출
3. `findThemeById()` 로 ThemeDef 조회
4. `applyTheme(themeDef)` 로 HTML에 `data-theme` 설정
5. CSS 변수 자동으로 재평가 (cascade에 의해)

---

## 5. 커스텀 테마 만들기

### UI에서 생성

**Settings > Appearance > Create Theme**

1. 기본 테마 선택 (light/dark)
2. 25개 색상 설정 (색상 선택기)
   - Background (5개)
   - Text (3개)
   - Border (2개)
   - Accent (4개)
   - Editor (5개)
   - Status (3개)
   - Graph (3개)
3. 테마 이름 입력
4. 저장 → Zustand `customThemes[]` 저장

### 구현 상세

`src/components/settings/AppearanceTab.tsx`:
- `ThemeEditor` 컴포넌트
- 25개 색상 카테고리별 그룹화
- 각 색상은 HTML `<input type="color">` 로 선택
- 실시간 preview (`style.setProperty()`)

### 내보내기 / 가져오기

**Export**:
```bash
Settings > Appearance > Export Theme
→ Tauri dialog.save() → JSON 파일 저장
```

**Import**:
```bash
Settings > Appearance > Import Theme
→ Tauri dialog.open() → JSON 파일 읽기 → 커스텀 테마로 추가
```

**파일 포맷** (JSON):
```json
{
  "id": "my-custom-theme",
  "name": "My Custom Theme",
  "base": "dark",
  "builtIn": false,
  "colors": {
    "--color-bg-default": "#1a1a2e",
    "--color-text-primary": "#e2e8f0",
    ...
  }
}
```

### 마이그레이션 (v9 → v10)

이전 버전의 커스텀 테마는 오래된 CSS 변수 키명을 사용할 수 있습니다:

```typescript
// v9: "--color-accent" (없음)
// v10: "--color-accent-default" (신규)

export const THEME_KEY_MIGRATION_V10: Record<string, keyof ThemeColors> = {
  "--color-accent": "--color-accent-default",
  "--color-bg-primary": "--color-bg-default",
  "--color-bg-secondary": "--color-bg-subtle",
  // ...
};
```

Zustand `onRehydrateStorage` 에서 자동으로 마이그레이션됩니다:

```typescript
const migrateThemeColors(old: Record<string, string>): ThemeColors {
  const migrated: Record<string, string> = {};
  for (const [key, value] of Object.entries(old)) {
    const newKey = THEME_KEY_MIGRATION_V10[key] ?? key;
    migrated[newKey] = value;
  }
  // 빠진 키는 Default Light에서 채우기
  const defaults = BUILT_IN_THEMES[0].colors;
  for (const key of Object.keys(defaults)) {
    if (!(key in migrated)) {
      migrated[key] = defaults[key as keyof ThemeColors];
    }
  }
  return migrated as unknown as ThemeColors;
}
```

---

## 6. 의도적 예외 (Not Tokenized)

일부 색상은 **토큰화하지 않은 이유**가 있습니다:

| 항목 | 파일 | 개수 | 이유 |
|------|------|------|------|
| 파일 타입 아이콘 색상 | `src/components/file-tree/file-icon.tsx` | 13 | 언어 정체성 (JavaScript=노란색, Python=파란색 등). 테마 변경 시 아이콘 의미가 바뀌면 안 됨 |
| 테마 에디터 preview 색상 | `src/components/settings/AppearanceTab.tsx` | 5 | 설정 UI에서 색상 선택기의 배경. 고정 대비도 필요 |
| CodeMirror 문법 강조 | `src/styles/editor.css` (`.cm-*` selectors) | 9+ | 별도의 문법 강조 테마 시스템. Semantic 토큰과 독립적 |
| Shadow 토큰 | `src/styles/base.css` | 4 | `rgb(0 0 0 / N%)` 형식이므로 모든 테마에서 작동 |
| 기분/에너지 색상 | `src/components/journal/MoodBar.tsx`, `MoodTrend30.tsx` | 5 | 기분의 의미 (Deep=파란색, Calm=초록색). 테마 변경 시 변하면 안 됨 |
| 태그 색상 팔레트 | `src/components/journal/TagPanel.tsx` | 10+ | 사용자 선택 preset 색상. 테마와 무관 |
| Journal 런타임 변수 | `src/components/journal/*.tsx` | 11 | JavaScript에서 동적으로 설정 (CSS 토큰이 아님) |

---

## 7. 검증 & CI

### 감사 도구 (Audit Tool)

```bash
npm run audit:css-vars
```

**역할**: 모든 CSS + TSX 파일을 스캔하여 정의되지 않은 `var()` 참조 찾기

**출력**:
```
  Scanned: 19 CSS + 47 TSX/TS files
  Defined: 50 | Referenced: 48
  Allowlisted (JS runtime): 11 variables
  All CSS variables are defined (or allowlisted).
```

**Exit codes**:
- `0`: 성공
- `1`: 정의되지 않은 변수 발견

### Allowlist (11개 Journal 런타임 변수)

`scripts/audit-css-vars.ts` 에서:

```typescript
const ALLOWLIST = new Set([
  "--mood-deep",
  "--mood-calm",
  "--mood-neutral",
  "--mood-warm",
  "--mood-bright",
  "--mood-accent-rgb",
  "--journal-font-family",
  "--journal-line-height",
  "--journal-header-bg",
  "--journal-prompt-bg",
  "--journal-prompt-border",
]);
```

이 변수들은:
- CSS 토큰이 아니라 **JavaScript에서 런타임에 설정**
- 감사에서 무시됨 (allowlisted)
- 필요한 경우 JS 코드에서 `element.style.setProperty()` 로 설정

### CI 통합 (권장)

`.github/workflows/*.yml` 또는 `package.json` 의 pre-commit hook:

```json
{
  "scripts": {
    "lint": "npm run audit:css-vars && eslint ..."
  }
}
```

---

## 8. FAQ

### "색상을 바꾸고 싶어요. 어디서 수정하나요?"

1. 의미론적 토큰 이름을 알고 있다면:
   - `tokens/semantic/color-light.json` (또는 `color-dark.json`)
   - 해당 토큰의 `$value` 수정
   - `npm run tokens:build`

2. 모를 경우:
   - `src/styles/generated/semantic-light.css` 에서 `--color-*` 검색
   - 역으로 `tokens/semantic/color-light.json` 확인

3. 테마별로 다르게 하려면:
   - `color-light.json` 과 `color-dark.json` 에서 각각 값 설정

### "새 색상을 테마 선택 가능하게 만들려면?"

1. `src/types/theme.ts` 의 `ThemeColors` 인터페이스에 추가
2. `THEME_COLOR_KEYS` 에 메타데이터 추가
3. 8개 `BUILT_IN_THEMES` 모두에 색상값 추가
4. Store 마이그레이션 버전 +1
5. `npm run tokens:build`

이제 Settings > Appearance 에서 해당 색상을 커스터마이징할 수 있습니다.

### "테마 전환 시 색상이 안 바뀌어요. 왜죠?"

원인은 두 가지:

1. **하드코딩된 색상**:
   ```css
   /* 나쁜 예 */
   color: #3b82f6;

   /* 좋은 예 */
   color: var(--color-accent-default);
   ```

2. **CSS 변수가 `ThemeColors` 에 없음**:
   - 테마 설정에서 설정할 수 없는 색상
   - 예: CodeMirror 문법 강조색은 `ThemeColors` 에 없음
   - 해결: 해당 색상을 `ThemeColors` 에 추가 (위 FAQ 참고)

### "Semantic과 Primitive의 차이가 뭐예요?"

- **Primitive**: raw value (숫자, 문자열)
  ```json
  "blue": { "500": { "$value": "#3b82f6" } }
  ```
  → 다른 시스템에서도 재사용 가능 (예: 디자인 시스템)

- **Semantic**: 의미 (이 값이 무엇인가)
  ```json
  "accent": { "default": { "$value": "{color.blue.500}" } }
  ```
  → Baram 앱에서만 의미가 있음. 변경하면 UI 톤 전체가 바뀜

**규칙**: 컴포넌트에서는 **Semantic만 사용**. Primitive를 직접 참조하지 말 것.

### "CSS 변수를 직접 정의할 수 있나요?"

아니요. 생성된 CSS 변수(`src/styles/generated/`)는 수동 편집 금지입니다.

**올바른 방법**:
1. 의미론적 JSON 에서 수정
2. `npm run tokens:build` 실행
3. 생성된 CSS가 자동 업데이트됨

**예외**: Layout/spacing 같은 non-color 변수는 `src/styles/base.css` 에 직접 정의 가능:
```css
:root {
  --editor-padding: 4rem;
  --shadow-sm: 0 1px 2px rgb(0 0 0 / 10%);
}
```

### "Hex 색상을 바로 사용해도 되나요?"

아니요. 의도적 예외를 제외하고 모든 색상은 `var(--color-*)` 로 참조해야 합니다.

**예외** (하드코딩 허용):
- 파일 타입 아이콘 색상
- 테마 에디터 preview 색상
- CodeMirror 문법 강조 (별도 테마 시스템)
- Shadow 토큰 (`rgb(...)` 형식)
- 기분/에너지 색상 (의미론적)
- 태그 색상 팔레트 (사용자 선택)

---

## 9. 트러블슈팅

### `npm run tokens:build` 실패

**증상**:
```
Error: tokens/semantic/color-light.json: Invalid reference
```

**원인**: Semantic JSON에서 Primitive를 잘못 참조

**수정**:
```json
/* 잘못된 예 */
"$value": "{color.blue.500"  // } 빠짐

/* 올바른 예 */
"$value": "{color.blue.500}"
```

### `npm run audit:css-vars` 실패

**증상**:
```
UNDEFINED CSS VARIABLES (1):
  --color-my-new-token
    in src/styles/components.css
```

**원인**: CSS 파일에서 사용하지만 semantic JSON에 정의되지 않음

**수정**:
1. `tokens/semantic/color-light.json` 에 추가
2. `tokens/semantic/color-dark.json` 에 추가
3. `npm run tokens:build`
4. `npm run audit:css-vars` 다시 실행

### 테마 변경 후 색상 깜빡임

**증상**: 테마 전환 시 CSS 변수가 한 프레임 동안 적용되지 않음

**원인**: 가능한 원인들:
- HTML의 `data-theme` 속성이 비동기로 업데이트됨
- CSS 리페인트 지연

**해결** (미적용, 향후 최적화):
- `requestAnimationFrame` 로 attribute 변경과 repaint 동기화

---

## 10. 참고 자료

- **W3C DTCG**: https://design-tokens.github.io/community-group/format/
- **Style Dictionary v5**: https://styledictionary.com/
- **Tailwind CSS v4**: https://tailwindcss.com/docs/v4
- **Baram 설계 문서**: `docs/design/part4-uiux.md` (§4.1 디자인 원칙)

---

**Last Updated**: 2026-03-21
**Version**: 1.0
**Author**: Baram Design Systems Team
