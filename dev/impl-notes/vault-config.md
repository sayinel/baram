## 설정 스코핑 설계

### 먼저 짚어야 할 핵심 질문

설정을 vault별로 나누기 전에, 각 설정 항목이 **"무엇에 속하는가"** 를 명확히 해야 합니다.

```
사람에 속하는 설정        vs      장소(vault)에 속하는 설정
──────────────────               ──────────────────────────
AI provider / API 키             Extension on/off (이 vault용)
테마 / 폰트 (취향)               Wikilink 활성 여부
단축키                           dailyNotesFolder 경로
spell check 여부                 Skills 폴더 경로
zoom 레벨                        serializationRules (팀 컨벤션)
```

이 구분이 흐릿하면 설정 시스템이 복잡해집니다.

---

## 설정 분류 체계

기존 `global-settings.json` 스키마를 기준으로 각 항목을 분류하면:

### 🔒 글로벌 전용 (vault별 오버라이드 불가)

이 설정들은 **사람/디바이스에 귀속**되어 vault마다 달라지면 안 됩니다.

```
appearance.theme            테마는 눈에 맞게 쓰는 것. vault마다 다르면 혼란
appearance.fontSize         같은 이유
appearance.fontFamily
appearance.lineHeight

ai.provider                 API 키는 사람 소유. vault마다 다른 키를 쓰지 않음
ai.apiKey
ai.ghostText.enabled        AI 기능 on/off는 사용자 선택

단축키                       keybindings은 근육 기억. vault마다 다르면 안 됨
spell check
zoom 레벨
```

**이유:** 이 설정들이 vault별로 다르면 컨텍스트 전환 시마다 "어, 폰트가 달라졌네?" 혼란이 생깁니다. 일관성이 UX의 핵심.

---

### ⚙️ vault별 오버라이드 가능 (`.baram/config.json`)

이 설정들은 **vault의 성격/목적에 귀속**됩니다.

**① Extension on/off**

```jsonc
// work-vault/.baram/config.json
{
  "extensions": {
    "enabled": ["ext-wikilink", "ext-skills", "ext-block-ref"],
    "disabled": ["ext-journal"]   // work vault에선 journal 불필요
  }
}

// journal-vault/.baram/config.json
{
  "extensions": {
    "enabled": ["ext-journal", "ext-wikilink"],
    "disabled": ["ext-skills"]    // journal에선 skills 불필요
  }
}
```

vault의 성격이 다르면 필요한 Extension이 다릅니다. Skills vault에서 journal Extension이 켜져 있을 필요 없고, journal vault에서 Skills Extension이 필요 없죠.

**② Markdown 직렬화 규칙**

```jsonc
{
  "markdown": {
    "serializationRules": {
      "bulletListMarker": "-"     // 팀 컨벤션: 하이픈 통일
    },
    "enableWikilink": true,       // 이 vault는 wikilink 사용
    "enableMermaid": false        // 이 vault엔 다이어그램 불필요
  }
}
```

팀 프로젝트 vault는 마크다운 스타일 컨벤션을 vault 단위로 통일하는 게 실용적입니다. Git으로 공유하는 파일이니까요.

**③ 파일/폴더 구조 설정**

```jsonc
{
  "editor": {
    "dailyNotesFolder": "entries",    // 이 vault의 daily 폴더명
    "skillsFolder": "prompts",        // 이 vault는 "prompts"라 부름
    "defaultNewFileLocation": "root"
  }
}
```

**④ AI 모델 (provider 제외)**

```jsonc
{
  "ai": {
    "model": "claude-haiku-4-5",      // 이 vault는 빠른 모델 선호
    "privacyMode": true,              // 이 vault는 외부 전송 금지
    "contextScope": "vault"           // AI 컨텍스트를 이 vault로 제한
  }
}
```

`provider`와 `apiKey`는 글로벌이지만, **어떤 모델을 쓸지, privacy mode 여부**는 vault마다 달라질 수 있습니다. 예: 개인 vault는 Claude Sonnet, 작은 스케치 vault는 Haiku로 비용 절감.

**⑤ Git 설정**

```jsonc
{
  "git": {
    "autoFetchInterval": 5,
    "autoPushOnCommit": true,         // 이 vault는 커밋 즉시 push
    "commitAuthor": "donghun <work@email.com>"
  }
}
```

---

### 🎨 vault별 오버라이드 가능 (appearance 한정)

테마/폰트는 글로벌이 원칙이지만, **한 가지 예외**를 허용하는 게 좋습니다.

```jsonc
// journal-vault/.baram/config.json
{
  "appearance": {
    "theme": "sepia"    // journal vault는 항상 sepia 테마
  }
}
```

**왜 예외인가:** Journal vault를 열 때 자동으로 sepia로 바뀌고, work vault로 전환하면 다시 dark로 돌아오는 경험은 **컨텍스트 전환의 시각적 신호**가 됩니다. vault의 분위기를 테마로 구분하고 싶은 사용자에게 강력한 UX입니다.

단, 이것은 **opt-in**. 기본값은 글로벌 테마를 따릅니다.

---

## 설정 우선순위 계층

```
글로벌 설정 (~/Library/Application Support/baram/settings.json)
     │
     └──→ vault 설정 (.baram/config.json) 으로 오버라이드
               │
               └──→ 파일별 YAML frontmatter로 오버라이드 (일부 항목)
                         예: privacy_mode: true (이 파일만 AI 전송 금지)
```

Rust 백엔드에서 설정을 resolve할 때:

```rust
fn resolve_settings(
    global: &GlobalSettings,
    vault_config: Option<&VaultConfig>,
    file_frontmatter: Option<&Frontmatter>,
) -> ResolvedSettings {
    let mut s = global.clone();
    if let Some(vc) = vault_config {
        s.merge_vault_config(vc);     // vault 오버라이드
    }
    if let Some(fm) = file_frontmatter {
        s.merge_frontmatter(fm);      // 파일 오버라이드
    }
    s
}
```

---

## 설정 UI 설계

### 설정 패널에서 scope 표시

```
Preferences (Cmd+,)

┌─────────────────────────────────────────────────────┐
│  🔍 설정 검색...                                      │
├──────────┬──────────────────────────────────────────┤
│ General  │  Extensions                               │
│ Editor   │                                          │
│ Markdown │  ┌─ 글로벌 기본값 ────────────────────┐  │
│ AI       │  │  ext-wikilink          ✅ ON        │  │
│ Appear.  │  │  ext-skills            ✅ ON        │  │
│ Exten.   │  │  ext-journal           ☐ OFF       │  │
│ Git      │  └────────────────────────────────────┘  │
│ Vault    │                                          │
│  설정    │  ┌─ work-vault 오버라이드 ────────────┐  │
│          │  │  ext-skills            ✅ ON (유지) │  │
│          │  │  ext-journal           ☐ OFF (유지)│  │
│          │  │  ext-mermaid           ✅ ON ← 추가│  │
│          │  └────────────────────────────────────┘  │
│          │  ℹ️  vault별 설정은 .baram/config.json에 저장 │
└──────────┴──────────────────────────────────────────┘
```

"Vault 설정" 탭은 현재 활성 vault가 있을 때만 활성화됩니다. Loose File 모드에서는 비활성.

---

## 최종 분류표

| 설정 항목               | 글로벌만 | vault 오버라이드 | 파일 오버라이드 |
| ------------------- | :--: | :---------: | :------: |
| 테마/폰트               |  기본값 |  opt-in 허용  |     —    |
| 에디터 줄높이/폭           |   ✅  |      —      |     —    |
| 단축키                 |   ✅  |      —      |     —    |
| AI provider/API 키   |   ✅  |      —      |     —    |
| AI 모델 선택            |  기본값 |      ✅      |     —    |
| AI privacy mode     |  기본값 |      ✅      |     ✅    |
| Extension on/off    |  기본값 |      ✅      |     —    |
| Markdown 직렬화 규칙     |  기본값 |      ✅      |     —    |
| dailyNotesFolder 경로 |  기본값 |      ✅      |     —    |
| skillsFolder 경로     |  기본값 |      ✅      |     —    |
| Git 설정              |  기본값 |      ✅      |     —    |
| spellCheck          |   ✅  |      —      |     —    |
| Snapshot 주기/개수      |  기본값 |      ✅      |     —    |

---

## 구현 관점

기존 설계에 이미 vault별 `config.json`이 있고 "글로벌과 동일한 스키마, 값이 있는 필드만 오버라이드" 구조가 명시되어 있습니다. 따라서 **새로운 구조를 만드는 게 아니라, 어떤 필드가 오버라이드 가능한지 명시적으로 정의**하는 것이 이번 결정의 핵심입니다.

Rust에서 `#[serde(skip_serializing_if = "Option::is_none")]` 패턴으로 vault config는 오버라이드할 필드만 기록하고, resolve 시 글로벌과 merge하면 됩니다. 구현 부담은 낮습니다.
