//! 공용 zip 추출 코어 — entry 수 · per-entry 크기 · total 크기 · compression ratio ·
//! path depth · compression method, 여섯 방어를 파라미터화해 `fs::extract_zip`(§53 Notion
//! import)와 `plugin::extract_zip_bounded`(§69 플러그인 설치)가 함께 쓴다.
//!
//! ‼️ 경로 안전(Zip Slip 판정 · `__MACOSX`/`.DS_Store` 스킵 · symlink 무해화)은 이 파일의
//! 관심사가 **아니다**. 두 호출자는 이미 독립적으로 검증된 서로 다른 방식 — fs는 수동
//! 정규화 후 하드 에러, plugin은 `enclosed_name()` 기반 스킵 — 을 쓰고 있고, 그 차이를
//! 지우는 것은 이 변경의 범위 밖이다. 이 파일이 다루는 것은 "엔트리의 출력 경로가 이미
//! 안전하다고 확정된 뒤" 적용되는 폭탄 방어뿐이다.
//!
//! 모든 한계는 아카이브가 자신에 대해 선언한 값(`file.size()`)이 아니라, 이 코어가 실제로
//! 읽은 바이트에 대해서만 검사한다 — 헤더가 4 KiB를 주장하며 기가바이트를 스트리밍해도
//! 그 주장은 무의미하다.

use std::io::Read;
use std::path::Path;

/// 이 코어가 강제하는 여섯 가지 한계. 호출자마다(플러그인 설치 vs Notion import) 값이
/// 다를 뿐 검사 로직은 같다.
#[derive(Clone, Copy)]
pub struct ExtractBounds {
    pub max_entries: usize,
    pub max_entry_bytes: u64,
    pub max_total_bytes: u64,
    pub max_ratio: u64,
    pub ratio_floor_bytes: u64,
    pub max_path_depth: usize,
    pub allowed_compression: &'static [zip::CompressionMethod],
}

/// 이 엔트리에 대해 알아야 할 것 — 호출자가 자신의 방식(Zip Slip 판정 등)으로 이미 확정한
/// 안전한 출력 경로와, 표시용 이름 두 가지(원본 헤더 이름 / 검증된 상대 경로)를 들고 온다.
pub struct EntryContext<'a> {
    pub method: zip::CompressionMethod,
    pub is_dir: bool,
    pub depth: usize,
    /// 아카이브 헤더가 그대로 주장하는 이름 — 압축 방식 거부 메시지에만 쓴다.
    pub raw_name: &'a str,
    /// 호출자가 안전을 확인한 뒤의 상대 경로 — 깊이 거부 메시지에 쓴다.
    pub relative_path: &'a Path,
    /// 실제로 쓸 절대 출력 경로.
    pub out_path: &'a Path,
    /// 아카이브 전체가 wire 위에서 차지한 바이트 수 — ratio 계산의 분모.
    pub compressed_len: u64,
    /// 이 엔트리 이전까지 이미 쓴 누적 바이트 수.
    pub total_written: u64,
}

/// 코어가 되돌리는 에러. 호출자는 각자의 에러 타입(`FsError` / `PluginError`)으로 변환한다.
#[derive(Debug)]
pub enum ArchiveError {
    Io(std::io::Error),
    /// 이 코어가 정책적으로 거부한 것 — 한계를 초과했다는 사람이 읽을 수 있는 설명.
    Refused(String),
}

impl std::fmt::Display for ArchiveError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ArchiveError::Io(e) => write!(f, "{e}"),
            ArchiveError::Refused(s) => write!(f, "{s}"),
        }
    }
}

impl std::error::Error for ArchiveError {}

impl From<std::io::Error> for ArchiveError {
    fn from(e: std::io::Error) -> Self {
        ArchiveError::Io(e)
    }
}

/// 아카이브가 선언한 엔트리 수를 첫 방어선으로 검사한다.
///
/// central directory는 `ZipArchive::new`가 이미 전부 파싱을 끝낸 뒤이므로 이 검사 자체는
/// 값싸지 않지만, `by_index`가 단 하나도 돌기 전에 거부해 이후의 모든 방어를 아예 겪지
/// 않게 한다. `kind`는 에러 메시지에 박히는 명사(예: "plugin archive" / "zip archive")로,
/// 다섯 개의 서로 다른 한계가 한 함수 안에 사는 상황에서 "무엇이 거부됐는지"뿐 아니라
/// "누가 거부했는지"까지 말해 준다.
pub fn check_entry_count(
    len: usize,
    bounds: &ExtractBounds,
    kind: &str,
) -> Result<(), ArchiveError> {
    if len > bounds.max_entries {
        return Err(ArchiveError::Refused(format!(
            "{kind} declares {len} entries, over the {} limit",
            bounds.max_entries
        )));
    }
    Ok(())
}

/// 한 엔트리에 대한 나머지 다섯 방어(압축 방식 · 경로 깊이 · per-entry · total · ratio)와
/// 실제 기록. 반환값은 이 엔트리가 쓴 바이트 수(디렉터리는 0) — 호출자가 다음 엔트리를
/// 위해 `total_written`을 누적하는 데 쓴다.
pub fn extract_entry<R: Read>(
    file: &mut R,
    ctx: EntryContext,
    bounds: &ExtractBounds,
    kind: &str,
) -> Result<u64, ArchiveError> {
    // BEFORE the first read of this entry — 허용되지 않은 코덱의 디코더가 아예 만들어지지
    // 않게 한다. 크기가 아니라 방식을 거부하는 이유는 방식이야말로 공격자의 숫자로부터
    // 할당하는 디코더가 생성될지 말지를 가르는 지점이기 때문이다.
    if !bounds.allowed_compression.contains(&ctx.method) {
        return Err(ArchiveError::Refused(format!(
            "{kind} entry {} uses compression method {}; only {} are allowed",
            ctx.raw_name,
            ctx.method,
            bounds
                .allowed_compression
                .iter()
                .map(|m| m.to_string())
                .collect::<Vec<_>>()
                .join(" and ")
        )));
    }

    // BEFORE any create_dir_all — 디렉터리는 바이트 상한이 전혀 보지 못하는 비용이다:
    // 부모 경로는 확장 바이트를 하나도 만들지 않으므로, 깊이는 공격자에게 공짜이고
    // 우리에게는 mkdir 폭탄이다.
    if ctx.depth > bounds.max_path_depth {
        return Err(ArchiveError::Refused(format!(
            "{kind} entry {} has {} path components, over the {} limit",
            ctx.relative_path.display(),
            ctx.depth,
            bounds.max_path_depth
        )));
    }

    if ctx.is_dir {
        std::fs::create_dir_all(ctx.out_path)?;
        return Ok(0);
    }
    if let Some(parent) = ctx.out_path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    // 세 상한이 모두 이 읽기 하나로 접힌다 — per-entry, 남은 total, 남은 ratio 허용치 중
    // 가장 작은 것이 실제 캡이다. 캡을 넘겨 쓰는 일은 있을 수 없다: `take(cap + 1)`이
    // 캡을 초과하는 순간 스트림을 끊는다.
    let by_entry = bounds.max_entry_bytes;
    let by_total = bounds.max_total_bytes.saturating_sub(ctx.total_written);
    // ratio 허용치는 `max(wire × ratio, floor)` — floor 아래에서는 ratio가 아무것도
    // 증명하지 못하는 통계이므로, 작은 아카이브가 그 통계 하나로 거부되지 않게 한다.
    let ratio_allowance = ctx
        .compressed_len
        .saturating_mul(bounds.max_ratio)
        .max(bounds.ratio_floor_bytes);
    let by_ratio = ratio_allowance.saturating_sub(ctx.total_written);
    let cap = by_entry.min(by_total).min(by_ratio);

    let mut out = std::fs::File::create(ctx.out_path)?;
    // `cap + 1`: 정확히 `cap`을 읽는 것은 합법이므로, 그 다음 한 바이트가 "한도를 채웠다"와
    // "한도를 넘으려 했다"를 가른다.
    let mut limited = file.take(cap + 1);
    let written = std::io::copy(&mut limited, &mut out)?;
    if written > cap {
        // 어떤 상한이 이 엔트리를 막았는지 이름을 대야 메시지가 "무엇을 올릴지"를 말해준다.
        // ratio를 먼저 확인하는 것은, 여러 상한이 동시에 걸린 경계에서 "이 모양이 폭탄처럼
        // 생겼다"고 말해 주는 쪽이 더 유용하기 때문이다.
        return Err(ArchiveError::Refused(if cap == by_ratio {
            format!(
                "{kind} expands past the {ratio_allowance} bytes allowed for its \
                 {} bytes on the wire ({}:1, minimum {})",
                ctx.compressed_len, bounds.max_ratio, bounds.ratio_floor_bytes
            )
        } else if cap == by_total {
            format!(
                "{kind} expands past the {} byte total limit",
                bounds.max_total_bytes
            )
        } else {
            format!(
                "{kind} entry {} exceeds the {} byte per-file limit",
                ctx.relative_path.display(),
                bounds.max_entry_bytes
            )
        }));
    }
    Ok(written)
}
