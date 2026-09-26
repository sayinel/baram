// §363 · §371 6a — 테마 패키지 매니페스트가 요구하지만 편집 화면이 모르는 값들(`PackageMeta`)과 id.
// `ThemeEditor.tsx` 에서 떼어 냈다 — 외관 내보내기(`appearance-export.tsx`)가 같은 입력과 같은 관문을
// 쓴다(스펙 0062 §4, 계획 0110 Task 2). 입력 컴포넌트는 `package-meta-fields.tsx` 다(컴포넌트 파일은
// 컴포넌트만 내보낸다 — `react-refresh/only-export-components`).
import { useEffect, useState } from "react";

import type { PackageMeta } from "../../themes/theme-package-export";

import { THEME_ID_RE } from "../../themes/theme-manifest";
import { slugifyThemeId } from "../../themes/theme-package-export";

export interface PackageMetaState {
  readonly author: string;
  /** 넷이 다 차고 id 형식이 맞는가 — 패키지 내보내기 버튼의 관문. */
  readonly complete: boolean;
  readonly description: string;
  readonly id: string;
  readonly license: string;
  readonly meta: PackageMeta;
  readonly setAuthor: (value: string) => void;
  readonly setDescription: (value: string) => void;
  /** 직접 고친 id — 이 뒤로는 이름을 따라가지 않는다. */
  readonly setId: (value: string) => void;
  readonly setLicense: (value: string) => void;
  readonly setVersion: (value: string) => void;
  readonly version: string;
}

export function usePackageMeta(name: string): PackageMetaState {
  // §363 — 배포용 패키지의 매니페스트가 요구하지만 이 입력을 쓰는 화면은 모르는 값들
  // (`PackageMeta`, theme-package-export.ts). 빈 채로 내보내면 설치되지 않는
  // 패키지가 나온다 — 0091 final review가 잡았듯 이것이 "유일한" 실패 모드는
  // 아니다(색 없는 모드가 조용히 빠지는 것도 별도 실패 모드다). 이 값들이
  // 전부 채워지기(그리고 id는 형식도 맞기) 전에는 이 실패 모드 하나만
  // 막으려고 패키지 내보내기 버튼을 비활성한다(complete).
  const [author, setAuthor] = useState("");
  const [description, setDescription] = useState("");
  const [license, setLicense] = useState("");
  const [version, setVersion] = useState("");
  // 0091 fix round 1, Finding 4(MEDIUM 4 판정): 배포 패키지의 id는 저자가
  // 가장 소유해야 하는 필드인데, 예전 코드는 그것을 저자가 보지도 못하는
  // 내부 타임스탬프(`custom-${Date.now()}`)로 정했다. 이름에서 뽑은 기본값을
  // 넣어 두되(slugifyThemeId), 저자가 자유롭게 고칠 수 있는 평범한 입력이다.
  const [id, setIdValue] = useState(() => slugifyThemeId(name));
  // 0091 fix round 2, Finding N1(MEDIUM, 재리뷰) — 위 초기값만으로는 부족했다.
  // 빌트인 테마를 열면 id가 예: "custom-default-light"로 채워지는데, 그 뒤
  // name을 "Solar Flare"로 바꿔도 id는 그대로 남는다 — 형식은 여전히
  // 유효하므로 complete 가드를 그대로 통과해, "Solar Flare"라는
  // 이름의 테마가 아무 경고 없이 custom-default-light라는 id로 나간다. 표준
  // 슬러그 필드 패턴으로 고친다: id 입력을 직접 건드리기 전까지는 name을
  // 따라가고, 한 번 건드리면 더 이상 따라가지 않는다.
  const [idTouched, setIdTouched] = useState(false);
  useEffect(() => {
    if (idTouched) return;
    setIdValue(slugifyThemeId(name));
  }, [name, idTouched]);
  const complete =
    author.trim() !== "" &&
    description.trim() !== "" &&
    license.trim() !== "" &&
    version.trim() !== "" &&
    THEME_ID_RE.test(id);
  return {
    author,
    complete,
    description,
    id,
    license,
    meta: { author, description, license, version },
    setAuthor,
    setDescription,
    setId: (value) => {
      setIdTouched(true);
      setIdValue(value);
    },
    setLicense,
    setVersion,
    version,
  };
}
