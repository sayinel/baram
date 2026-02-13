# /new-ipc — Rust IPC 커맨드 + TypeScript 타입 생성

새로운 Tauri IPC 커맨드를 Rust와 TypeScript 양쪽에 동시 생성한다.

## 사용법

```
/new-ipc read_file --module fs --input "path: string" --output "string" --ref §3.2
/new-ipc llm_complete --module llm --input "prompt: string, model: string" --output "stream" --ref §6.3
/new-ipc search_files --module search --input "query: string, options: SearchOptions" --output "SearchResult[]" --ref §3.2
```

## 인자

- `$ARGUMENTS`: 커맨드 이름과 옵션
  - 이름: snake_case (Rust 관례)
  - `--module`: Rust 모듈 (fs, search, index, git, llm, export, config)
  - `--input`: 입력 파라미터 (TypeScript 표기)
  - `--output`: 반환 타입 ("stream"이면 이벤트 기반)
  - `--ref`: 설계 문서 섹션

---

## 생성 파일

### 1. Rust 커맨드 핸들러

`src-tauri/src/commands/{module}_cmd.rs` 에 추가:

```rust
/// {설계 문서 참조} - {설명}
#[tauri::command]
pub async fn {command_name}({params}) -> Result<{ReturnType}, String> {
    crate::{module}::{command_name}({args})
        .await
        .map_err(|e| e.to_string())
}
```

### 2. Rust 모듈 함수

`src-tauri/src/{module}/mod.rs` 에 추가:

```rust
pub async fn {command_name}({params}) -> Result<{ReturnType}, {Module}Error> {
    // TODO: 구현
    todo!()
}
```

### 3. TypeScript IPC 타입

`src/ipc/types.ts` 에 추가:

```typescript
export interface {PascalCommandName}Input {
  {각 입력 파라미터}
}

export type {PascalCommandName}Output = {출력 타입}
```

### 4. TypeScript invoke 래퍼

`src/ipc/invoke.ts` 에 추가:

```typescript
export async function {camelCommandName}(input: {PascalCommandName}Input): Promise<{Output}> {
  return invoke('{command_name}', input)
}
```

### 5. 스트리밍인 경우 이벤트 리스너

`--output stream` 시 추가로 생성:

```typescript
// src/ipc/invoke.ts
export function on{PascalCommandName}Token(
  callback: (token: string) => void
): UnlistenFn {
  return listen('{command_name}:token', (event) => {
    callback(event.payload.token)
  })
}
```

---

## ipc-registry.json 업데이트

```json
{
  "name": "{command_name}",
  "input": { ... },
  "output": "{type}",
  "module": "{module}",
  "spec": "§{번호}",
  "phase": {번호},
  "status": "implemented"
}
```

## main.rs 등록

`src-tauri/src/main.rs`의 `invoke_handler`에 새 커맨드를 추가한다:

```rust
.invoke_handler(tauri::generate_handler![
    // ... 기존 커맨드
    commands::{module}_cmd::{command_name},
])
```
