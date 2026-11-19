//! §397 원본 보기용 타일 피라미드. 이 태스크의 범위는 순수한 피라미드 계산·쓰기(`pyramid`)와
//! manifest 가 싣는 레벨 크기 타입뿐이다.

// 호출자(캐시 계층)가 다음 태스크에서 생길 때까지 크레이트 안에 쓰는 곳이 없다 — 그때 이 allow 를 뗀다.
#[allow(dead_code)]
mod pyramid;

use serde::{Deserialize, Serialize};

#[allow(unused_imports)] // 캐시 계층(다음 태스크)이 쓰기 전까지 크레이트 안에 호출자가 없다
pub(crate) use pyramid::{
    level_sizes, tile_grid, write_pyramid, PyramidInfo, JPEG_QUALITY, TILE_PX,
};

/// 한 레벨의 픽셀 크기.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LevelSize {
    pub w: u32,
    pub h: u32,
}
