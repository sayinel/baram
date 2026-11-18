// §56d/§329.2 — the thumbnailer's refusal code.
//
// `ipc/thumbnail.ts` 와 따로 둔 이유: 썸네일을 쓰는 시험 여럿이 그 모듈을 통째로 mock 한다. 판정이
// 거기 있으면 mock 이 판정까지 지워, 시험이 실제 판정을 지나지 않는다.

/**
 * ‼️ Rust `thumbnail_cmd::THUMBNAIL_NOT_AUTHORIZED` 와 한 글자도 다르면 안 된다 —
 * `__tests__/thumbnail-error-codes.test.ts` 가 Rust 소스에서 긁어 대조한다. 어긋나면 권한 거절이
 * 디코드 실패처럼 캐시에서 밀려나기 전까지 기억되어, 사용자가 그 폴더를 연 뒤에도 프리뷰 대신
 * 원본을 그린다.
 */
const THUMBNAIL_NOT_AUTHORIZED = "THUMBNAIL_NOT_AUTHORIZED";

/**
 * 지금 열린 context 어느 것도 이 경로를 읽게 해 주지 않아 썸네일러가 거절했다.
 *
 * 파일에 대한 답이 아니라 **지금 열린 context** 에 대한 답이다 — 사용자가 그 폴더를 열면 바뀐다.
 */
export function isThumbnailNotAuthorizedError(e: unknown): boolean {
  return typeof e === "string" && e === THUMBNAIL_NOT_AUTHORIZED;
}
