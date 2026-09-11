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

use serde::Serialize;
use tokio::sync::Mutex;

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
///
/// `tokio::sync::Mutex` — `font_cmd::font_list` 가 이 락을 "비어있나 확인 → 없으면 계산 →
/// 저장" 전체 구간 동안 쥔 채로 `spawn_blocking` 을 `.await` 한다. `std::sync::Mutex` 로는
/// await 지점을 넘겨 가드를 들고 있을 수 없다(Send 보장이 없다) — 그리고 그 가드를 놓았다
/// 다시 잡는 예전 방식은 캐시가 빈 동안 동시에 들어온 두 호출이 ~250ms 열거를 두 번 돌리는
/// stampede 를 만들었다. 락을 계속 쥐고 있으면 두 번째 호출자는 첫 번째가 다 쓸 때까지
/// 기다렸다가 캐시를 읽는다 — 계산은 한 번만 돈다.
pub struct FontCache(pub Mutex<Option<Vec<FontFamily>>>);

impl FontCache {
    pub fn new() -> Self {
        Self(Mutex::new(None))
    }
}

/// 웹뷰가 실제로 지정할 수 있는 패밀리 이름인지.
///
/// 점으로 시작하는 이름은 macOS 가 내부용 숨김 패밀리에 쓰는 관례다 —
/// `.SF NS`, `.AppleSystemUIFont`, `.ADT slab Numeric`. CSS 의 `<family-name>` 은
/// `<custom-ident>` 이라 점으로 시작할 수 없고 인용해도 그 이름으로 조회되지
/// 않으므로, 목록에 두면 "골랐는데 아무 일도 안 일어나는" 항목이 된다. 그건
/// §346 이 끝내려던 바로 그 오해(사용자가 자기 탓으로 읽는 무효 항목)를 열거
/// 쪽에서 다시 만드는 것이다. 빈 이름도 같은 이유로 뺀다.
fn is_selectable_family(name: &str) -> bool {
    let name = name.trim();
    !name.is_empty() && !name.starts_with('.')
}

/// face 목록을 패밀리 단위로 접는다.
///
/// `has_korean` 은 OR — 한 face 라도 한글을 가지면 그 패밀리로 한글을 쓸 수 있다.
/// `monospaced` 는 AND — 하나라도 아니면 고정폭이라고 광고하면 안 된다. 표에서
/// 열이 안 맞는 것보다 목록에 안 보이는 게 낫다.
///
/// 고를 수 없는 이름은 여기서 떨어진다([`is_selectable_family`]) — 이 함수가
/// 열거의 모든 face 가 웹뷰로 가기 전에 지나는 유일한 깔때기라, 걸러 내는 자리도
/// 여기 하나뿐이어야 미래의 다른 face 생산자도 같은 규칙을 받는다.
pub fn aggregate(faces: Vec<RawFace>) -> Vec<FontFamily> {
    use std::collections::BTreeMap;
    let mut by_name: BTreeMap<String, FontFamily> = BTreeMap::new();
    for f in faces {
        if !is_selectable_family(&f.family) {
            continue;
        }
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

    // 위 테스트는 이미 다른 두 이름의 정렬 "순서"만 본다 — 같은 패밀리가 대소문자만
    // 다르게 보고될 때 한 항목으로 "합쳐지는지"는 아무 테스트도 안 봤다. 집계 키를
    // `to_lowercase()` 에서 정확 일치로 바꿔도 이 테스트가 없으면 아무것도 안 깨지고
    // 패밀리가 조용히 중복 나열된다(리뷰 Important #4).
    #[test]
    fn merges_faces_of_the_same_family_reported_in_different_casing() {
        let families = aggregate(vec![
            face("Georgia", false, 400, false),
            face("GEORGIA", false, 700, false),
        ]);
        assert_eq!(families.len(), 1);
        // 먼저 본 표기를 유지한다 — `or_insert_with` 는 첫 삽입에서만 `name` 을 채운다.
        assert_eq!(families[0].name, "Georgia");
        assert_eq!(families[0].weights, vec![400, 700]);
    }

    // 동훈님 보고 — "설치된 서체" 에 `.ADT slab Numeric` 처럼 점으로 시작하는
    // 이름들이 섞여 있는데 골라도 적용이 안 된다. 파일은 실재하지만
    // (`ADTNumeric.ttc`) 패밀리 이름이 숨김 관례를 쓴다.
    #[test]
    fn drops_the_hidden_families_whose_name_starts_with_a_dot() {
        let families = aggregate(vec![
            face(".ADT slab Numeric", false, 400, false),
            face(".SF NS", false, 400, false),
            face("Georgia", false, 400, false),
        ]);
        assert_eq!(
            families.iter().map(|f| f.name.as_str()).collect::<Vec<_>>(),
            vec!["Georgia"]
        );
    }

    // 빈 이름도 고를 수 없다 — 그리고 목록에서는 누를 수 있어 보이는 빈 줄이 된다.
    #[test]
    fn drops_a_family_whose_name_is_blank() {
        let families = aggregate(vec![
            face("   ", false, 400, false),
            face("Georgia", false, 400, false),
        ]);
        assert_eq!(
            families.iter().map(|f| f.name.as_str()).collect::<Vec<_>>(),
            vec!["Georgia"]
        );
    }

    // 규칙은 접두사에 대한 것이다. 이름 "안" 의 점까지 막으면 멀쩡한 패밀리가
    // 사라진다 — 버전 표기에 점을 쓰는 패밀리가 있다.
    #[test]
    fn keeps_a_family_whose_name_merely_contains_a_dot() {
        let families = aggregate(vec![face("Sample 1.1 Display", false, 400, false)]);
        assert_eq!(families.len(), 1);
    }

    // §350 — 반환 구조체는 파일 경로를 담지 않는다. 담으면 vault 밖 파일
    // 시스템 구조가 웹뷰로 새어 나간다.
    //
    // 필드 허용목록으로 검증한다 — 문자열 부분일치 denylist(리뷰 이전 버전)는
    // "location"·"origin" 처럼 이름이 안 걸리는 필드나, 구분자 없는 파일명
    // ("Georgia.ttf")·역슬래시 전용 Windows 경로처럼 값이 안 걸리는 경로를 통과시킨다.
    // 이 모듈 헤더가 이 테스트를 승인 게이트 대상이 아닌 세 근거 중 하나로 인용하므로
    // (§329~§336), 그 주장을 지탱하려면 새 필드가 이름과 무관하게 실패해야 한다 —
    // 허용목록을 넓히는 건 항상 의도적인 결정이어야 한다.
    #[test]
    fn the_returned_shape_carries_no_filesystem_path() {
        use std::collections::BTreeSet;

        let json = serde_json::to_value(FontFamily {
            name: "Inter".into(),
            monospaced: false,
            has_korean: false,
            weights: vec![400],
        })
        .unwrap();
        let keys: BTreeSet<&str> = json
            .as_object()
            .expect("FontFamily serializes to a JSON object")
            .keys()
            .map(String::as_str)
            .collect();
        let allowed: BTreeSet<&str> = ["hasKorean", "monospaced", "name", "weights"]
            .into_iter()
            .collect();
        assert_eq!(
            keys, allowed,
            "FontFamily's serialized field set changed — widen the allowlist deliberately \
             only if the new field carries no filesystem path"
        );
    }
}
