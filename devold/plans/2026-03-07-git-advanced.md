# Git 고급 (§67) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Git Basic(M9)을 확장하여 커밋 히스토리, stash, 원격 push/pull 기능을 추가한다.

**Architecture:** 기존 git2 crate 기반 Rust 모듈(`src-tauri/src/git/mod.rs`)에 함수를 추가하고, IPC 커맨드 → TypeScript invoke → Zustand store → React UI 패턴을 따른다.

**Tech Stack:** git2 (Rust), Tauri IPC, Zustand, React

---

## Task 1: Commit History (Rust + IPC)

**Files:**
- Modify: `src-tauri/src/git/mod.rs` — add `log()` function
- Modify: `src-tauri/src/commands/git_cmd.rs` — add `git_log` command
- Modify: `src-tauri/src/lib.rs` — register `git_log` in invoke_handler
- Modify: `src/ipc/types.ts` — add `GitLogEntry` type
- Modify: `src/ipc/invoke.ts` — add `gitLog()` function

### Step 1: Add Rust `log()` function + structs

```rust
// In git/mod.rs

#[derive(Debug, Serialize, Clone)]
pub struct GitLogEntry {
    pub oid: String,
    pub short_oid: String,
    pub message: String,
    pub author: String,
    pub author_email: String,
    pub timestamp: i64,  // Unix epoch seconds
    pub parent_count: usize,
}

/// Get commit history for the repository.
pub fn log(path: &str, max_count: usize) -> Result<Vec<GitLogEntry>, String> {
    let repo = open_repo(path)?;
    let mut revwalk = repo.revwalk().map_err(|e| e.message().to_string())?;
    revwalk.push_head().map_err(|e| e.message().to_string())?;
    revwalk.set_sorting(git2::Sort::TIME).map_err(|e| e.message().to_string())?;

    let mut entries = Vec::new();
    for (i, oid_result) in revwalk.enumerate() {
        if i >= max_count { break; }
        let oid = oid_result.map_err(|e| e.message().to_string())?;
        let commit = repo.find_commit(oid).map_err(|e| e.message().to_string())?;
        let author = commit.author();
        entries.push(GitLogEntry {
            oid: oid.to_string(),
            short_oid: oid.to_string()[..7].to_string(),
            message: commit.message().unwrap_or("").to_string(),
            author: author.name().unwrap_or("").to_string(),
            author_email: author.email().unwrap_or("").to_string(),
            timestamp: commit.time().seconds(),
            parent_count: commit.parent_count(),
        });
    }
    Ok(entries)
}
```

### Step 2: Add IPC command

```rust
// In commands/git_cmd.rs
#[tauri::command]
pub async fn git_log(path: String, max_count: Option<usize>) -> Result<Vec<crate::git::GitLogEntry>, String> {
    let count = max_count.unwrap_or(50);
    tokio::task::spawn_blocking(move || crate::git::log(&path, count))
        .await
        .map_err(|e| e.to_string())?
}
```

### Step 3: Register in lib.rs invoke_handler
### Step 4: Add TypeScript types and invoke wrapper
### Step 5: Add cargo test for log function
### Step 6: Commit — `feat(§67): add git commit history (git_log IPC)`

---

## Task 2: Stash (Rust + IPC)

**Files:**
- Modify: `src-tauri/src/git/mod.rs` — add stash functions
- Modify: `src-tauri/src/commands/git_cmd.rs` — add stash commands
- Modify: `src-tauri/src/lib.rs` — register stash commands
- Modify: `src/ipc/types.ts` — add `GitStashEntry` type
- Modify: `src/ipc/invoke.ts` — add stash invoke wrappers

### Step 1: Add Rust stash functions

```rust
#[derive(Debug, Serialize, Clone)]
pub struct GitStashEntry {
    pub index: usize,
    pub message: String,
    pub oid: String,
}

pub fn stash_save(path: &str, message: &str, include_untracked: bool) -> Result<String, String> { ... }
pub fn stash_list(path: &str) -> Result<Vec<GitStashEntry>, String> { ... }
pub fn stash_pop(path: &str, index: usize) -> Result<(), String> { ... }
pub fn stash_drop(path: &str, index: usize) -> Result<(), String> { ... }
```

### Step 2: Add IPC commands (git_stash_save, git_stash_list, git_stash_pop, git_stash_drop)
### Step 3: Register in lib.rs
### Step 4: Add TypeScript types and invoke wrappers
### Step 5: Commit — `feat(§67): add git stash operations (save/list/pop/drop)`

---

## Task 3: Remote Push/Pull (Rust + IPC)

**Files:**
- Modify: `src-tauri/src/git/mod.rs` — add remote functions
- Modify: `src-tauri/src/commands/git_cmd.rs` — add remote commands
- Modify: `src-tauri/src/lib.rs` — register remote commands
- Modify: `src/ipc/types.ts` — add remote types
- Modify: `src/ipc/invoke.ts` — add remote invoke wrappers

### Step 1: Add Rust remote functions

```rust
#[derive(Debug, Serialize, Clone)]
pub struct GitRemoteInfo {
    pub name: String,
    pub url: String,
}

pub fn list_remotes(path: &str) -> Result<Vec<GitRemoteInfo>, String> { ... }
pub fn pull(path: &str, remote: &str, branch: &str) -> Result<String, String> { ... }
pub fn push(path: &str, remote: &str, branch: &str) -> Result<(), String> { ... }
pub fn fetch(path: &str, remote: &str) -> Result<(), String> { ... }
```

Note: push/pull with auth requires credential callbacks. Use `git2::RemoteCallbacks` with `credentials` callback that reads from system credential store or SSH agent.

### Step 2: Add IPC commands
### Step 3: Register in lib.rs
### Step 4: Add TypeScript types and invoke wrappers
### Step 5: Commit — `feat(§67): add git remote operations (push/pull/fetch)`

---

## Task 4: Git Store + Panel Enhancement (Frontend)

**Files:**
- Modify: `src/stores/git-store.ts` — add history, stash, remote state + actions
- Modify: `src/components/sidebar/GitPanel.tsx` — add tabs/sections for history, stash, remote

### Step 1: Extend git-store with history, stash, remote actions
### Step 2: Add commit history section to GitPanel (collapsible list with oid, message, author, time)
### Step 3: Add stash section (save button, stash list with pop/drop)
### Step 4: Add remote section (push/pull buttons, behind/ahead indicator)
### Step 5: Commit — `feat(§67): enhance GitPanel with history, stash, and remote UI`

---

## Task 5: Delete Branch (Rust + IPC + UI)

**Files:**
- Modify: `src-tauri/src/git/mod.rs` — add `delete_branch()`
- Modify: `src-tauri/src/commands/git_cmd.rs` — add `git_delete_branch`
- Modify: `src-tauri/src/lib.rs` — register
- Modify: `src/ipc/types.ts`, `src/ipc/invoke.ts`
- Modify: `src/stores/git-store.ts`, `src/components/sidebar/GitPanel.tsx`

### Step 1: Implement and wire through all layers
### Step 2: Commit — `feat(§67): add git delete branch`

---

## Task 6: Tests + Verification

### Step 1: Run full vitest suite
### Step 2: Run cargo test
### Step 3: Run tsc
### Step 4: Update progress.json
### Step 5: Commit — `feat(§67): complete git advanced features`

---

## Dependency Graph

```
Task 1 (Log) ────────┐
Task 2 (Stash) ──────┤──→ Task 4 (Frontend) ──→ Task 6 (Verify)
Task 3 (Remote) ─────┤
Task 5 (Delete Branch)┘
```

Tasks 1, 2, 3, 5 are independent (parallel). Task 4 depends on all of them. Task 6 is final.
