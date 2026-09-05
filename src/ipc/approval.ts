// §331–§335 Vault 경계 승인 IPC 래퍼.
import { invoke } from "@tauri-apps/api/core";

/** Rust `approval::ApprovalEntry`의 직렬화 형태. */
export interface ApprovedRoot {
  approvedAt: number;
  kind: "dir" | "file";
  path: string;
}

/**
 * `pick_approved_dir`가 피커 **타이틀**을 고르는 데 쓰는 값.
 *
 * ‼️ 유니온인 이유: Rust는 `match purpose.as_str()`의 `_` 갈래로 오타를 조용히 받아
 * "폴더 열기" 타이틀을 띄운다 — 즉 오타가 런타임에 드러나지 않는다. `"open-folder"`는
 * 실수가 아니라 **의도적으로** 그 `_` 갈래를 친다.
 */
export type PickDirPurpose =
  "journal" | "open-folder" | "plugin-dev" | "tasks" | "zettelkasten";

/**
 * ‼️ Rust `approval_cmd::APPROVAL_DENIED`와 **한 글자도 다르면 안 된다**. 이 값이
 * "사용자가 거부했다"와 "진짜 오류가 났다"를 가른다 — 어긋나면 거부가 오류 토스트로
 * 보이거나, 오류가 조용히 삼켜진다.
 *
 * 두 상수 모두 `__tests__/approval-error-codes.test.ts`가 Rust 소스에서 긁어 대조한다.
 */
const APPROVAL_DENIED = "VAULT_APPROVAL_DENIED";

/**
 * ‼️ Rust `approval_cmd::PATH_UNRESOLVABLE`와 한 글자도 다르면 안 된다.
 *
 * 거부와 **다른** 값이어야 한다: 이건 사용자가 누른 결과가 아니라 경로가 해석되지
 * 않은 결과다(삭제된 vault·언마운트된 드라이브). 같은 값이면 뜬 적도 없는 다이얼로그를
 * 두고 "허용되지 않았습니다"라고 말하게 된다 (§335 리뷰 I3).
 */
const PATH_UNRESOLVABLE = "VAULT_PATH_UNRESOLVABLE";

export function isApprovalDeniedError(e: unknown): boolean {
  return typeof e === "string" && e === APPROVAL_DENIED;
}

/** 경로를 해석할 수 없었다 — 사용자 거부가 **아니다**. */
export function isPathUnresolvableError(e: unknown): boolean {
  return typeof e === "string" && e === PATH_UNRESOLVABLE;
}

/**
 * §334 다이얼로그 없이 승인 여부만 묻는다. 시작 시 비활성 컨텍스트를 조용히 재등록할지
 * 가르는 데 쓴다 — 미승인이면 건너뛰고, 확인은 사용자가 실제로 전환할 때 뜬다.
 *
 * ‼️ 이 판정을 TS에서 재구현하지 말 것. `covers`는 컴포넌트 단위 prefix + canonicalize를
 * 쓰고, 심링크 해석은 웹뷰에서 불가능하다 — 두 번째 열거는 반드시 어긋난다.
 */
export async function isPathApproved(path: string): Promise<boolean> {
  return invoke("is_path_approved", { path });
}

export async function listApprovedRoots(): Promise<ApprovedRoot[]> {
  return invoke("list_approved_roots");
}

/**
 * 폴더를 고르게 하고, 고른 경로를 승인한다. 취소하면 null.
 *
 * `startDir`는 피커가 **열릴 위치**일 뿐이다 — 승인은 사용자가 실제로 고른 경로에만 붙으므로
 * 이 인자로는 경계가 넓어지지 않는다. 생략하면 OS가 기억하는 마지막 폴더에서 열리고, 넘기면
 * 그 폴더에서(없으면 홈에서) 열린다. 즉 **빈 문자열도 의미 있는 값**이다: "설정된 폴더가
 * 없으니 홈에서 열어라". 판정은 Rust `resolve_start_dir` 한 곳에 있다.
 *
 * ‼️ 인자 이름은 Rust `start_dir`와 짝이다(Tauri가 camelCase↔snake_case를 잇는다). 어긋나면
 * 키가 조용히 무시되고 시작 위치가 늘 홈이 된다 — 타입 오류도, 런타임 오류도 나지 않는다.
 */
export async function pickApprovedDir(
  purpose: PickDirPurpose,
  startDir?: string,
): Promise<null | string> {
  return invoke("pick_approved_dir", { purpose, startDir });
}

/** 단독 파일을 고르게 하고, 그 파일을 승인한다. 취소하면 null. */
export async function pickApprovedFile(): Promise<null | string> {
  return invoke("pick_approved_file");
}

export async function revokeApprovedRoot(path: string): Promise<void> {
  return invoke("revoke_approved_root", { path });
}
