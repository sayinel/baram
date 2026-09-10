// §350 시스템 폰트 열거.
//
// 웹뷰는 이걸 할 수 없다 — WebKit 에 queryLocalFonts() 가 없다. 그래서
// 설정의 서체 목록이 §346 까지 하드코딩 14종이었고, 실측에서 그중 3종만
// 이 머신에 실재했다(설치된 폰트는 442개였다).
//
// fontdb 를 고른 이유: FaceInfo 가 families[0](영문 US 패밀리명) · monospaced ·
// weight 를 그대로 주고, load_system_fonts() 가 macOS(/Library,
// /System/Library, AssetsV2 다운로드 폰트, /Network, ~/Library) · Windows
// (%SYSTEMROOT%\Fonts + AppData) · Linux(fontconfig, 실패 시 알려진 디렉터리)를
// 모두 덮으며 하위 디렉터리를 재귀한다 — /System/Library/Fonts/Supplemental 의
// Georgia 가 그 재귀 없이는 안 잡힌다.
//
// 세리프 판정: 뺐다. ttf-parser 0.25.1 의 `src` 전체를 grep 해도 family_class·
// panose·sFamilyClass 접근자가 하나도 없다 — OS/2 바이트를 고정 오프셋으로 직접
// 읽는 방법은 기형 폰트에서 조용히 틀리고 그걸 검증할 픽스처 코퍼스가 따로
// 필요해서 채택하지 않았다. `serif` 필드는 아예 구조체에서 뺀다 — 항상 false 를
// 채우면 UI 가 "세리프 없음"이라고 거짓말한다.
//
// 보안: 이 모듈의 커맨드는 경로 인자를 받지 않고, asset scope 를 부여하지 않으며
// (Scope::allow_* 호출 없음), 반환 구조체에 파일 경로를 담지 않는다. §329~§336 의
// 승인 게이트 대상이 아닌 이유가 그 세 가지다.

use std::sync::Mutex;

use serde::Serialize;

/// 한 face 에서 뽑은 원시 정보 — `aggregate` 의 입력. 테스트가 직접 만든다.
pub struct RawFace {
    pub family: String,
    pub has_korean: bool,
    pub monospaced: bool,
    pub weight: u16,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FontFamily {
    pub has_korean: bool,
    pub monospaced: bool,
    pub name: String,
    pub weights: Vec<u16>,
}

/// 열거 결과 캐시. 442개 파싱을 앱 시작에 얹지 않으려고 피커가 처음 열릴 때
/// 채운다. `refresh` 로 비운다.
pub struct FontCache(pub Mutex<Option<Vec<FontFamily>>>);

impl FontCache {
    pub fn new() -> Self {
        Self(Mutex::new(None))
    }
}

/// face 목록을 패밀리 단위로 접는다.
///
/// `has_korean` 은 OR — 한 face 라도 한글을 가지면 그 패밀리로 한글을 쓸 수 있다.
/// `monospaced` 는 AND — 하나라도 아니면 고정폭이라고 광고하면 안 된다. 표에서
/// 열이 안 맞는 것보다 목록에 안 보이는 게 낫다.
pub fn aggregate(faces: Vec<RawFace>) -> Vec<FontFamily> {
    use std::collections::BTreeMap;
    let mut by_name: BTreeMap<String, FontFamily> = BTreeMap::new();
    for f in faces {
        let key = f.family.to_lowercase();
        let entry = by_name.entry(key).or_insert_with(|| FontFamily {
            has_korean: false,
            monospaced: true,
            name: f.family.clone(),
            weights: Vec::new(),
        });
        entry.has_korean |= f.has_korean;
        entry.monospaced &= f.monospaced;
        if !entry.weights.contains(&f.weight) {
            entry.weights.push(f.weight);
        }
    }
    let mut out: Vec<FontFamily> = by_name.into_values().collect();
    for f in out.iter_mut() {
        f.weights.sort_unstable();
    }
    out.sort_by_key(|f| f.name.to_lowercase());
    out
}

/// OS 폰트 디렉터리를 훑어 face 목록을 만든다.
pub fn enumerate_faces() -> Vec<RawFace> {
    let mut db = fontdb::Database::new();
    db.load_system_fonts();
    let ids: Vec<_> = db
        .faces()
        .map(|f| (f.id, f.families.clone(), f.monospaced, f.weight.0))
        .collect();
    ids.into_iter()
        .filter_map(|(id, families, monospaced, weight)| {
            let family = families.first()?.0.clone();
            let has_korean = db.with_face_data(id, face_has_korean).unwrap_or(false);
            Some(RawFace {
                family,
                has_korean,
                monospaced,
                weight,
            })
        })
        .collect()
}

/// U+AC00(가)의 글리프가 있는지. 한글 지원 칩의 근거.
fn face_has_korean(data: &[u8], index: u32) -> bool {
    ttf_parser::Face::parse(data, index)
        .ok()
        .and_then(|f| f.glyph_index('가'))
        .is_some()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn face(name: &str, mono: bool, weight: u16, korean: bool) -> RawFace {
        RawFace {
            family: name.to_string(),
            monospaced: mono,
            weight,
            has_korean: korean,
        }
    }

    #[test]
    fn aggregates_faces_of_one_family_into_a_single_entry() {
        let families = aggregate(vec![
            face("Inter", false, 400, false),
            face("Inter", false, 700, false),
        ]);
        assert_eq!(families.len(), 1);
        assert_eq!(families[0].name, "Inter");
        assert_eq!(families[0].weights, vec![400, 700]);
    }

    #[test]
    fn sorts_weights_and_drops_duplicates() {
        let families = aggregate(vec![
            face("Inter", false, 700, false),
            face("Inter", false, 400, false),
            face("Inter", false, 400, false),
        ]);
        assert_eq!(families[0].weights, vec![400, 700]);
    }

    // 한 face 라도 한글을 가지면 패밀리는 한글을 지원한다 — OR 집계.
    #[test]
    fn a_family_has_korean_if_any_face_does() {
        let families = aggregate(vec![
            face("Noto Sans KR", false, 400, false),
            face("Noto Sans KR", false, 700, true),
        ]);
        assert!(families[0].has_korean);
    }

    // 고정폭은 반대다 — 하나라도 아니면 그 패밀리를 고정폭으로 광고하면 안 된다.
    #[test]
    fn a_family_is_monospaced_only_if_every_face_is() {
        let families = aggregate(vec![
            face("Mixed", true, 400, false),
            face("Mixed", false, 700, false),
        ]);
        assert!(!families[0].monospaced);
    }

    #[test]
    fn sorts_families_case_insensitively_by_name() {
        let families = aggregate(vec![
            face("zapf", false, 400, false),
            face("Inter", false, 400, false),
        ]);
        assert_eq!(
            families.iter().map(|f| f.name.as_str()).collect::<Vec<_>>(),
            vec!["Inter", "zapf"]
        );
    }

    // §350 — 반환 구조체는 파일 경로를 담지 않는다. 담으면 vault 밖 파일
    // 시스템 구조가 웹뷰로 새어 나간다. 필드가 늘면 이 테스트가 실패한다.
    #[test]
    fn the_returned_shape_carries_no_filesystem_path() {
        let json = serde_json::to_string(&FontFamily {
            name: "Inter".into(),
            monospaced: false,
            has_korean: false,
            weights: vec![400],
        })
        .unwrap();
        for banned in ["path", "Path", "file", "source", "dir", "/"] {
            assert!(
                !json.contains(banned),
                "serialized FontFamily leaks {banned}: {json}"
            );
        }
    }
}
