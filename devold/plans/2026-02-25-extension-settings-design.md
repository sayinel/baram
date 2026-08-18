# Extension Settings System — Design

## Problem

Extension에 설정이 필요할 때마다 `settings-store.ts`에 필드를 하드코딩하고, `SettingsModal.tsx`에 UI를 수동 추가해야 한다. 확장성이 없고, 향후 Plugin Marketplace(§69)에서도 재사용이 불가능하다.

## Solution

`registry.json`에 Extension별 `settings` 스키마를 선언하면, Settings 모달의 **Extensions 탭**이 스키마를 읽어 UI를 자동 생성한다.

## registry.json Schema Extension

각 Extension 엔트리에 선택적 `settings` 배열 추가:

```json
{
  "name": "codeBlock",
  "settings": [
    {
      "key": "codeBlockLineNumbers",
      "type": "boolean",
      "label": "Line Numbers",
      "description": "Show line numbers in code blocks",
      "default": false
    },
    {
      "key": "codeBlockStyle",
      "type": "select",
      "label": "Code Block Style",
      "description": "Visual style for code blocks",
      "default": "default",
      "options": [
        { "value": "default", "label": "Default" },
        { "value": "minimal", "label": "Minimal" },
        { "value": "contrast", "label": "Contrast" },
        { "value": "paper", "label": "Paper" }
      ]
    }
  ]
}
```

### Supported Setting Types

| type | UI Control | Params |
|------|-----------|--------|
| `boolean` | ToggleSwitch | — |
| `select` | `<select>` dropdown | `options: {value, label}[]` |
| `number` | `<input type="range">` | `min`, `max`, `step` |
| `string` | `<input type="text">` | `placeholder?` |

## Data Storage

### extensionSettings map

`settings-store.ts`에 동적 키-값 맵 추가:

```typescript
extensionSettings: Record<string, unknown>;
setExtensionSetting: (key: string, value: unknown) => void;
getExtensionSetting: (key: string, defaultValue: unknown) => unknown;
```

### Migration

기존 하드코딩된 Extension 설정을 `extensionSettings`로 마이그레이션:

- `codeBlockLineNumbers` → `extensionSettings["codeBlockLineNumbers"]`
- `codeBlockStyle` → `extensionSettings["codeBlockStyle"]`
- `diagrams` → `extensionSettings["diagrams"]`

**하위 호환**: 기존 `useSettingsStore((s) => s.codeBlockStyle)` 호출이 동작하도록 computed getter 유지.

## Settings Modal Changes

### Markdown 탭 (축소)

Extension 관련 설정 제거. 남는 항목:
- Inline Math (on/off)
- Highlight (on/off)
- Strikethrough (on/off)
- Smart Punctuation (on/off)

### Extensions 탭 (신규, 7번째)

registry.json에서 `settings`가 정의된 Extension들을 Extension별 섹션으로 그룹:

```
Extensions
├── Code Block
│   ├── Line Numbers: [toggle]
│   └── Style: [select]
├── Mermaid Diagrams
│   └── Diagrams Enabled: [toggle]
└── (향후 Extension 추가 시 자동 표시)
```

## File Changes

| File | Change |
|------|--------|
| `src/extensions/registry.json` | `settings` 배열 추가 (codeBlock, mermaidBlock) |
| `src/stores/settings-store.ts` | `extensionSettings` map + migration + compat getters |
| `src/components/settings/SettingsModal.tsx` | Extensions 탭 추가, Markdown 탭 축소 |
| `src/components/settings/ExtensionsTab.tsx` | 신규 — registry 기반 자동 렌더링 |
| `src/App.css` | Extensions 탭 스타일 |

## Extension Consuming Settings

Extension 코드에서 설정 읽기:

```typescript
// Before (하드코딩)
const style = useSettingsStore((s) => s.codeBlockStyle);

// After (동일 — 호환 getter 제공)
const style = useSettingsStore((s) => s.codeBlockStyle);

// 또는 새 API
const style = useSettingsStore((s) => s.getExtensionSetting("codeBlockStyle", "default"));
```
