// §347 번들 서체의 라이선스 — 배포되는 산출물에 실제로 실리는 텍스트.
//
// 왜 이 파일이 있는가: OFL 1.1 §2 는 폰트 재배포를 "사본마다 저작권 표기와 이
// 라이선스가 함께 있을 것"에 조건 짓는다. `src/assets/fonts/` 에 `.txt` 두 개를
// 두는 것만으로는 그 조건을 못 채운다 — `src/assets/` 는 Vite 소스 디렉터리이고,
// 거기서 실제로 참조되는 것은 두 woff2 뿐이라 빌드된 `dist/` 에는 라이선스
// 파일도 표기도 없었다(폰트 바이너리는 둘 다 있었다). 즉 배포되는 앱이 OFL 서체
// 두 개를 표기 없이 재배포하는 상태였다.
//
// 왜 `?raw` 인가(Tauri `bundle.resources` 가 아니라):
//   · `?raw` 는 저 `.txt` 의 **바이트를 그대로** 청크에 싣는다. 그 청크가 곧
//     배포되는 산출물이므로, 조건이 "파일을 어디에 뒀는가"가 아니라 "배포물이
//     텍스트를 들고 있는가"로 충족된다. 게이트도 파생 비교 하나로 끝난다.
//   · 같은 값을 그대로 사용자에게 보여줄 수 있다 — §347 이 요구한 두 반쪽(표기와
//     라이선스 텍스트)이 한 가지 방법으로 동시에 채워진다. `bundle.resources` 는
//     바이너리 옆에 플랫폼별 경로로 파일을 두기만 하고, 그걸 다시 읽어 보여주려면
//     정적 문자열 하나를 위해 fs/resource capability 를 넓혀야 한다 — 이 저장소가
//     §260·§329–§336 에서 좁혀 둔 바로 그 표면이다.
//   · AboutModal 은 `AppDialogs.tsx` 에서 lazy 로 로드되므로 이 ~9KB 는 About
//     청크에만 있고 초기 번들에 들어가지 않는다.
//
// 텍스트를 여기 손으로 옮겨 적지 않는 이유: 그러면 upstream 과 바이트가 같다는
// 성질이 사라진다. 파일이 출처고, 이 모듈은 그 파일을 번들로 옮기는 통로다.
import jetbrainsMonoOFL from "../../assets/fonts/OFL-JetBrainsMono.txt?raw";
import pretendardOFL from "../../assets/fonts/OFL-Pretendard.txt?raw";
import { BUNDLED_FONTS } from "./bundled-fonts";

/** OFL 1.1 공식 텍스트가 있는 곳 — About 모달의 링크가 여는 주소. */
export const OFL_URL =
  "https://openfontlicense.org/open-font-license-official-text/";

export interface BundledFontLicense {
  /** 정확한 CSS 패밀리명 — `BUNDLED_FONTS` 에서 온다. */
  family: string;
  /** `licenseFile` 의 전문. About 모달이 그대로 보여 준다. */
  text: string;
}

/**
 * `?raw` import 경로는 Vite 가 정적 문자열 리터럴을 요구해서 여기 남는 유일한
 * 중복이다 — `export-font-embed.ts` 의 `?url` 표와 같은 사정이고, 같은 방식으로
 * (소스 스캔 가드, `font-licenses.test.ts`) `BUNDLED_FONTS[].licenseFile` 과
 * 대조한다.
 */
const LICENSE_TEXTS: Record<string, string> = {
  "OFL-JetBrainsMono.txt": jetbrainsMonoOFL,
  "OFL-Pretendard.txt": pretendardOFL,
};

/** 대응 항목이 없으면 즉시 던진다 — 표기 없는 재배포는 조용히 넘어갈 일이 아니다. */
function licenseTextFor(licenseFile: string): string {
  const text = LICENSE_TEXTS[licenseFile];
  if (text === undefined) {
    throw new Error(
      `§347: no ?raw import registered in font-licenses.ts for bundled font license "${licenseFile}"`,
    );
  }
  return text;
}

/** 번들 서체별 저작권 표기 + 라이선스 전문, `BUNDLED_FONTS` 순서대로. */
export const BUNDLED_FONT_LICENSES: readonly BundledFontLicense[] =
  BUNDLED_FONTS.map((f) => ({
    family: f.family,
    text: licenseTextFor(f.licenseFile),
  }));
