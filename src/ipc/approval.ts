// §331–§335 Vault 경계 승인 IPC 래퍼.
import { invoke } from "@tauri-apps/api/core";

/** Rust `approval::ApprovalEntry`의 직렬화 형태. */
export interface ApprovedRoot {
  approvedAt: number;
  kind: "dir" | "file";
  path: string;
}

/**
 * ‼️ Rust `approval_cmd::APPROVAL_DENIED`와 **한 글자도 다르면 안 된다**. 이 값이
 * "사용자가 거부했다"와 "진짜 오류가 났다"를 가른다 — 어긋나면 거부가 오류 토스트로
 * 보이거나, 오류가 조용히 삼켜진다.
 */
const APPROVAL_DENIED = "VAULT_APPROVAL_DENIED";

export function isApprovalDeniedError(e: unknown): boolean {
  return typeof e === "string" && e === APPROVAL_DENIED;
}

export async function listApprovedRoots(): Promise<ApprovedRoot[]> {
  return invoke("list_approved_roots");
}

/** 폴더를 고르게 하고, 고른 경로를 승인한다. 취소하면 null. */
export async function pickApprovedDir(purpose: string): Promise<null | string> {
  return invoke("pick_approved_dir", { purpose });
}

/** 단독 파일을 고르게 하고, 그 파일을 승인한다. 취소하면 null. */
export async function pickApprovedFile(): Promise<null | string> {
  return invoke("pick_approved_file");
}

export async function revokeApprovedRoot(path: string): Promise<void> {
  return invoke("revoke_approved_root", { path });
}
